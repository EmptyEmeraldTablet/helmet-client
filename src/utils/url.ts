const normalizeBase = (serverUrl: string) => serverUrl.replace(/\/$/, '')

export const resolveStorageUrl = (
  path: string | null | undefined,
  serverUrl: string,
): string | null => {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }
  if (path.startsWith('/storage')) {
    const base = normalizeBase(serverUrl)
    const root = base.endsWith('/api') ? base.slice(0, -4) : base
    return root ? `${root}${path}` : path
  }
  return path
}
