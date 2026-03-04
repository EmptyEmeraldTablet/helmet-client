<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { uploadImage } from '@/api/upload'
import { getSettings } from '@/utils/settings'
import { resolveStorageUrl } from '@/utils/url'
import { useCamera } from '@/composables/useCamera'
import type { UploadResult } from '@/types/detection'

const settings = ref(getSettings())
const file = ref<File | null>(null)
const previewUrl = ref<string | null>(null)
const uploading = ref(false)
const result = ref<UploadResult | null>(null)
const dailyCount = ref(0)

const videoRef = ref<HTMLVideoElement | null>(null)
const { active, start, stop, capture } = useCamera()

const canUpload = computed(() => Boolean(file.value && settings.value.apiKey && settings.value.deviceId))
const annotatedUrl = computed(() =>
  resolveStorageUrl(result.value?.annotated_image_url, settings.value.serverUrl),
)

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
            <el-button v-else type="warning" plain @click="stop">Stop</el-button>
            <el-button v-if="active" type="success" @click="handleCapture">Capture</el-button>
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
