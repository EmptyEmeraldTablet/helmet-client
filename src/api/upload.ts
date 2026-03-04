import axios from 'axios'
import type { ApiResponse } from '@/types/api'
import type { UploadResult } from '@/types/detection'

const normalizeBase = (serverUrl: string) => {
  const base = serverUrl.replace(/\/$/, '')
  return base.endsWith('/api') ? base : `${base}/api`
}

export const uploadImage = async (options: {
  serverUrl: string
  apiKey: string
  deviceId: string
  file: File
}): Promise<ApiResponse<UploadResult>> => {
  const form = new FormData()
  form.append('file', options.file)
  form.append('device_id', options.deviceId)

  const response = await axios.post<ApiResponse<UploadResult>>(
    `${normalizeBase(options.serverUrl)}/upload`,
    form,
    {
      headers: {
        'X-API-Key': options.apiKey,
      },
    },
  )

  return response.data
}

export const testConnection = async (serverUrl: string): Promise<boolean> => {
  const base = serverUrl.replace(/\/$/, '')
  try {
    await axios.get(`${base}/health`)
    return true
  } catch (error) {
    return false
  }
}
