import { onBeforeUnmount, ref } from 'vue'

export const useCamera = () => {
  const stream = ref<MediaStream | null>(null)
  const active = ref(false)

  const start = async (video: HTMLVideoElement | null) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera API not supported')
    }
    stream.value = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    })
    if (video) {
      video.srcObject = stream.value
      await video.play()
    }
    active.value = true
  }

  const stop = () => {
    stream.value?.getTracks().forEach((track) => track.stop())
    stream.value = null
    active.value = false
  }

  const capture = (video: HTMLVideoElement | null): string | null => {
    if (!video || !video.videoWidth || !video.videoHeight) {
      return null
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.92)
  }

  onBeforeUnmount(() => {
    stop()
  })

  return { stream, active, start, stop, capture }
}
