export function formatDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function calculateDuration(startDate: string, stopDate?: string): string {
  const start = new Date(startDate).getTime()
  const end = stopDate ? new Date(stopDate).getTime() : Date.now()
  const ms = end - start
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds < 1 ? '<1' : seconds}s`
}
