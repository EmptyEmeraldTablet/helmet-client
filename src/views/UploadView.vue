<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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
    const violation = data.has_violation ? 'Violation' : 'OK'
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

const canUpload = computed(() => Boolean(file.value && settings.value.apiKey && settings.value.deviceId))
const annotatedUrl = computed(() =>
  resolveStorageUrl(result.value?.annotated_image_url, settings.value.serverUrl),
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
    if (!active.value) {
      await start(videoRef.value)
    }
    await connect(wsUrl.value)
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

const handleStopStream = () => {
  if (!streaming.value) return
  if (streamTimer.value) {
    window.clearInterval(streamTimer.value)
    streamTimer.value = null
  }
  sendStop({ stream_id: streamId.value })
  disconnect()
  streaming.value = false
  stop()
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
  handleStopStream()
})
</script>

<template>
  <section class="panel">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div class="panel-title">Upload & Detect</div>
        <div class="panel-subtitle">Submit images for helmet detection.</div>
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
            <el-tag :type="streamStatus === 'open' ? 'success' : 'warning'">
              {{ streamStatusLabel }}
            </el-tag>
            <span class="panel-subtitle" style="margin-left: 4px;">
              1-2 FPS
            </span>
          </div>
          <div class="panel-subtitle" style="margin-top: 8px;">
            {{ streamFeedback }}
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
        <el-tag :type="result.has_violation ? 'danger' : 'success'">
          {{ result.has_violation ? 'Violation' : 'Compliant' }}
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
