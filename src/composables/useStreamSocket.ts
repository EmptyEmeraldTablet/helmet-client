import { onBeforeUnmount, ref } from 'vue'

type StreamStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

type StreamEnvelope = {
  type: string
  data: Record<string, unknown>
}

type StreamEvent = {
  event: string
  data: Record<string, unknown>
}

export const useStreamSocket = () => {
  const status = ref<StreamStatus>('idle')
  const socket = ref<WebSocket | null>(null)
  const lastEvent = ref<StreamEvent | null>(null)

  const connect = (url: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!url || status.value === 'connecting' || status.value === 'open') {
        resolve()
        return
      }
      status.value = 'connecting'
      socket.value = new WebSocket(url)

      socket.value.onopen = () => {
        status.value = 'open'
        resolve()
      }
      socket.value.onerror = () => {
        status.value = 'error'
        reject(new Error('WebSocket error'))
      }
      socket.value.onclose = () => {
        status.value = 'closed'
      }
      socket.value.onmessage = (event) => {
        try {
          lastEvent.value = JSON.parse(event.data) as StreamEvent
        } catch (error) {
          lastEvent.value = null
        }
      }
    })

  const disconnect = () => {
    socket.value?.close()
    socket.value = null
    status.value = 'closed'
  }

  const send = (payload: StreamEnvelope) => {
    if (socket.value && status.value === 'open') {
      socket.value.send(JSON.stringify(payload))
    }
  }

  const sendStart = (data: Record<string, unknown>) => {
    send({ type: 'start', data })
  }

  const sendFrame = (data: Record<string, unknown>) => {
    send({ type: 'frame', data })
  }

  const sendStop = (data: Record<string, unknown>) => {
    send({ type: 'stop', data })
  }

  onBeforeUnmount(() => {
    disconnect()
  })

  return { status, lastEvent, connect, disconnect, sendStart, sendFrame, sendStop }
}
