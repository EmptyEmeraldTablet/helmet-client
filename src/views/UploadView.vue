<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { uploadImage } from '@/api/upload'
import { getSettings } from '@/utils/settings'
import { resolveStorageUrl } from '@/utils/url'
import { useCamera } from '@/composables/useCamera'
import { useStreamSocket } from '@/composables/useStreamSocket'
import type { UploadResult } from '@/types/detection'

const settings = ref(getSettings())
const file = ref<File | null>(null)
const previewUrl = ref<string | null>(null)
const uploading = ref(false)
const result = ref<UploadResult | null>(null)
const dailyCount = ref(0)

const videoRef = ref<HTMLVideoElement | null>(null)
const { active, start, stop, capture } = useCamera()
const streaming = ref(false)
const streamId = ref('')
const frameIndex = ref(0)
const streamTimer = ref<number | null>(null)
const streamIntervalMs = 500

const { status: streamStatus, lastEvent, connect, disconnect, sendStart, sendFrame, sendStop } =
  useStreamSocket()

const normalizeLabel = (label: string) => {
  const key = label.toLowerCase()
  if (key === 'no_helmet' || key === 'head') return 'no_helmet'
  if (key === 'helmet' || key === 'vest') return key
  return key
}

const getSafetyCounts = (detections: UploadResult['detections'] | null | undefined) => {
  const items = detections ?? []
  let helmetCount = 0
  let vestCount = 0
  for (const item of items) {
    const label = normalizeLabel(item.label)
    if (label === 'helmet') helmetCount += 1
    if (label === 'vest') vestCount += 1
  }
  return { helmetCount, vestCount, total: items.length }
}

const isSafetyViolation = (
  detections: UploadResult['detections'] | null | undefined,
  fallback?: boolean,
) => {
  const { helmetCount, vestCount, total } = getSafetyCounts(detections)
  if (!total) return Boolean(fallback)
  return helmetCount === 0 || vestCount === 0
}

const streamStatusLabel = computed(() => {
  if (streamStatus.value === 'open') return 'Connected'
  if (streamStatus.value === 'connecting') return 'Connecting'
  if (streamStatus.value === 'error') return 'Error'
  return 'Offline'
})

const streamFeedback = computed(() => {
  if (!lastEvent.value) return 'No stream events yet.'
  const event = lastEvent.value.event
  const data = lastEvent.value.data || {}
  if (event === 'new_result') {
    const frameIndex = (data.frame_index as number | undefined) ?? '-'
    const detections = Array.isArray(data.detections)
      ? (data.detections as UploadResult['detections'])
      : []
    const violation = isSafetyViolation(detections, data.has_violation as boolean | undefined)
      ? 'Violation'
      : 'Compliant'
    const latency = (data.latency_ms as number | undefined) ?? '-'
    return `Frame ${frameIndex}: ${violation} (${latency} ms)`
  }
  if (event === 'alert') {
    const frameIndex = (data.frame_index as number | undefined) ?? '-'
    const count = (data.violation_count as number | undefined) ?? 1
    return `Alert on frame ${frameIndex}: ${count}`
  }
  if (event === 'error') {
    return `Error: ${String(data.message || 'Unknown error')}`
  }
  if (event === 'ack') {
    return `Ack: ${String(data.status || 'accepted')}`
  }
  return `Event: ${event}`
})

const streamFrames = ref<{ url: string; timestamp: string }[]>([])
const playbackIndex = ref(0)
const playbackTimer = ref<number | null>(null)
const playbackIntervalMs = 1000

const playbackUrl = computed(() => {
  if (!streamFrames.value.length) return null
  const index = playbackIndex.value % streamFrames.value.length
  return streamFrames.value[index]?.url || null
})

const stopPlayback = () => {
  if (playbackTimer.value) {
    window.clearInterval(playbackTimer.value)
    playbackTimer.value = null
  }
}

const canUpload = computed(() => Boolean(file.value && settings.value.apiKey && settings.value.deviceId))
const annotatedUrl = computed(() =>
  resolveStorageUrl(result.value?.annotated_image_url, settings.value.serverUrl),
)
const resultViolation = computed(() =>
  isSafetyViolation(result.value?.detections, result.value?.has_violation),
)

const wsUrl = computed(() => {
  const base = settings.value.serverUrl.replace(/\/$/, '')
  const root = base.endsWith('/api') ? base.slice(0, -4) : base
  const wsBase = root.replace('https://', 'wss://').replace('http://', 'ws://')
  const trimmed = wsBase.replace(/\/$/, '')
  const apiKey = encodeURIComponent(settings.value.apiKey || '')
  return `${trimmed}/ws/stream?api_key=${apiKey}`
})

const buildStreamId = () => {
  if (crypto && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `stream-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const loadDailyCount = () => {
  const today = new Date().toISOString().slice(0, 10)
  const raw = localStorage.getItem('helmet_upload_stats')
  if (!raw) {
    dailyCount.value = 0
    return
  }
  try {
    const parsed = JSON.parse(raw) as { date: string; count: number }
    if (parsed.date === today) {
      dailyCount.value = parsed.count
    } else {
      dailyCount.value = 0
    }
  } catch (error) {
    dailyCount.value = 0
  }
}

const incrementDailyCount = () => {
  const today = new Date().toISOString().slice(0, 10)
  const count = dailyCount.value + 1
  dailyCount.value = count
  localStorage.setItem('helmet_upload_stats', JSON.stringify({ date: today, count }))
}

const updatePreview = (newFile: File) => {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
  previewUrl.value = URL.createObjectURL(newFile)
}

const handleFileChange = (uploadFile: any) => {
  const selected = uploadFile.raw as File
  if (!selected) return
  file.value = selected
  updatePreview(selected)
}

const handleStartCamera = async () => {
  try {
    await start(videoRef.value)
  } catch (error) {
    ElMessage.error('Unable to access camera')
  }
}

const handleCapture = async () => {
  const dataUrl = capture(videoRef.value)
  if (!dataUrl) {
    ElMessage.warning('Capture failed')
    return
  }
  const blob = await (await fetch(dataUrl)).blob()
  const capturedFile = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' })
  file.value = capturedFile
  updatePreview(capturedFile)
  stop()
}

const handleStartStream = async () => {
  if (!settings.value.apiKey) {
    ElMessage.warning('Configure API key in Settings')
    return
  }
  if (!settings.value.deviceId) {
    ElMessage.warning('Configure device ID in Settings')
    return
  }
  if (streaming.value) return

  try {
    if (streamStatus.value !== 'open') {
      await connect(wsUrl.value)
    }
    if (!active.value) {
      await start(videoRef.value)
    }
  } catch (error) {
    ElMessage.error('Stream connection failed')
    return
  }

  streamId.value = buildStreamId()
  frameIndex.value = 0
  const resolution = videoRef.value
    ? `${videoRef.value.videoWidth}x${videoRef.value.videoHeight}`
    : ''
  sendStart({
    device_id: settings.value.deviceId,
    stream_id: streamId.value,
    fps: 2,
    resolution,
    source: 'webcam',
  })

  streaming.value = true
  streamTimer.value = window.setInterval(() => {
    const dataUrl = capture(videoRef.value)
    if (!dataUrl) return
    frameIndex.value += 1
    sendFrame({
      stream_id: streamId.value,
      frame_index: frameIndex.value,
      timestamp: new Date().toISOString(),
      image_base64: dataUrl,
    })
  }, streamIntervalMs)
}

const stopStreaming = () => {
  if (!streaming.value) return
  if (streamTimer.value) {
    window.clearInterval(streamTimer.value)
    streamTimer.value = null
  }
  sendStop({ stream_id: streamId.value })
  streaming.value = false
  stop()
  stopPlayback()
}

const handleStopStream = () => {
  stopStreaming()
}

const handleConnect = async () => {
  if (!settings.value.apiKey) {
    ElMessage.warning('Configure API key in Settings')
    return
  }
  try {
    await connect(wsUrl.value)
  } catch (error) {
    ElMessage.error('Connection failed')
  }
}

const handleDisconnect = () => {
  stopStreaming()
  disconnect()
  stopPlayback()
}

const handleUpload = async () => {
  if (!file.value) {
    ElMessage.warning('Select a file first')
    return
  }
  if (!settings.value.apiKey || !settings.value.deviceId) {
    ElMessage.warning('Configure API key and device ID in Settings')
    return
  }

  uploading.value = true
  result.value = null
  try {
    const response = await uploadImage({
      serverUrl: settings.value.serverUrl,
      apiKey: settings.value.apiKey,
      deviceId: settings.value.deviceId,
      file: file.value,
    })
    result.value = response.data
    incrementDailyCount()
    ElMessage.success('Upload completed')
  } catch (error) {
    ElMessage.error('Upload failed')
  } finally {
    uploading.value = false
  }
}

onMounted(() => {
  loadDailyCount()
})

onBeforeUnmount(() => {
  stopStreaming()
  disconnect()
  stopPlayback()
})

watch(lastEvent, (event) => {
  if (!event?.data) return
  if (event.event !== 'new_result' && event.event !== 'alert') return
  const data = event.data
  const annotated = data.annotated_image_url as string | undefined
  const original = data.original_image_url as string | undefined
  const rawUrl = annotated || original
  if (!rawUrl) return
  const resolved = resolveStorageUrl(rawUrl, settings.value.serverUrl)
  if (!resolved) return
  const timestamp = String(data.created_at || new Date().toISOString())
  streamFrames.value = [{ url: resolved, timestamp }, ...streamFrames.value].slice(0, 12)
  playbackIndex.value = 0
})

watch(
  () => streamFrames.value.length,
  (length) => {
    if (length > 1 && playbackTimer.value === null) {
      playbackTimer.value = window.setInterval(() => {
        if (!streamFrames.value.length) return
        playbackIndex.value = (playbackIndex.value + 1) % streamFrames.value.length
      }, playbackIntervalMs)
    }
    if (length <= 1 && playbackTimer.value !== null) {
      stopPlayback()
    }
  },
)

watch(streamStatus, (value) => {
  if (value === 'closed' || value === 'error') {
    stopPlayback()
  }
})
</script>

<template>
  <section class="panel">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div class="panel-title">Upload & Detect</div>
        <div class="panel-subtitle">Submit images for helmet + vest detection.</div>
      </div>
      <div class="badge">Today: {{ dailyCount }} uploads</div>
    </div>

    <div class="grid-2" style="margin-top: 16px;">
      <div class="panel" style="box-shadow: none;">
        <div class="panel-title" style="font-size: 16px;">Select Image</div>
        <el-upload
          action="#"
          :auto-upload="false"
          :show-file-list="false"
          accept="image/*"
          @change="handleFileChange"
        >
          <el-button type="primary">Choose File</el-button>
        </el-upload>

        <div style="margin-top: 16px;">
          <img v-if="previewUrl" class="preview" :src="previewUrl" alt="preview" />
          <div v-else class="panel-subtitle">No image selected.</div>
        </div>

        <el-button
          style="margin-top: 16px;"
          type="success"
          :loading="uploading"
          :disabled="!canUpload"
          @click="handleUpload"
        >
          Upload & Detect
        </el-button>
      </div>

      <div class="panel" style="box-shadow: none;">
        <div class="panel-title" style="font-size: 16px;">Camera Capture</div>
        <div class="camera-shell">
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <el-button
              v-if="streamStatus !== 'open'"
              type="primary"
              plain
              @click="handleConnect"
            >
              Connect
            </el-button>
            <el-button v-else type="warning" plain @click="handleDisconnect">
              Disconnect
            </el-button>
            <el-tag :type="streamStatus === 'open' ? 'success' : 'warning'">
              {{ streamStatusLabel }}
            </el-tag>
          </div>
          <video ref="videoRef" class="camera-video" autoplay playsinline muted></video>
          <div style="display: flex; gap: 8px;">
            <el-button v-if="!active" type="primary" plain @click="handleStartCamera">
              Start Camera
            </el-button>
            <el-button
              v-else
              type="warning"
              plain
              @click="streaming ? handleStopStream() : stop()"
            >
              Stop
            </el-button>
            <el-button v-if="active" type="success" :disabled="streaming" @click="handleCapture">
              Capture
            </el-button>
          </div>
          <div style="display: flex; gap: 8px; align-items: center; margin-top: 12px;">
            <el-button v-if="!streaming" type="primary" @click="handleStartStream">
              Start Stream
            </el-button>
            <el-button v-else type="danger" @click="handleStopStream">Stop Stream</el-button>
            <span class="panel-subtitle" style="margin-left: 4px;">
              1-2 FPS
            </span>
          </div>
          <div class="panel-subtitle" style="margin-top: 8px;">
            {{ streamFeedback }}
          </div>
          <div class="stream-preview-shell">
            <div class="panel-subtitle">Recent Frames</div>
            <img
              v-if="playbackUrl"
              :src="playbackUrl"
              alt="stream preview"
              class="stream-preview"
            />
            <div v-else class="panel-subtitle">No frames received yet.</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="panel">
    <div class="panel-title">Result</div>
    <div class="panel-subtitle" style="margin-bottom: 12px;">
      Detection summary and annotated output.
    </div>

    <div v-if="result">
      <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 12px;">
        <el-tag :type="resultViolation ? 'danger' : 'success'">
          {{ resultViolation ? 'Violation' : 'Compliant' }}
        </el-tag>
        <span class="panel-subtitle">Detections: {{ result.detections.length }}</span>
        <span class="panel-subtitle">Time: {{ result.process_time_ms ?? '-' }} ms</span>
      </div>
      <img
        v-if="annotatedUrl"
        :src="annotatedUrl"
        alt="annotated"
        class="preview"
      />
      <div style="margin-top: 12px; font-family: 'IBM Plex Mono', monospace; font-size: 12px;">
        Task: {{ result.task_id }}
      </div>
    </div>
    <div v-else class="panel-subtitle">No result yet. Upload an image to see output.</div>
  </section>
</template>
