export type ClientSettings = {
  serverUrl: string
  apiKey: string
  deviceId: string
  streamToken: string
}

const SETTINGS_KEY = 'helmet_client_settings'

export const getSettings = (): ClientSettings => {
  const raw = localStorage.getItem(SETTINGS_KEY)
  if (raw) {
    try {
      return JSON.parse(raw) as ClientSettings
    } catch (error) {
      // fall through to defaults
    }
  }

  return {
    serverUrl: import.meta.env.VITE_DEFAULT_SERVER_URL || 'http://localhost:8000',
    apiKey: import.meta.env.VITE_DEFAULT_API_KEY || '',
    deviceId: '',
    streamToken: import.meta.env.VITE_DEFAULT_STREAM_TOKEN || '',
  }
}

export const saveSettings = (settings: ClientSettings): void => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}
