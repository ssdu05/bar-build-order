import type { Player, Replay } from './schemas'

export const idFor = (url: string) => url.replace(/\/$/, '').split('/').at(-1)!
export const mapName = (api: Replay) =>
  api.Map?.scriptName || api.hostSettings?.mapname || 'Unknown map'
export const teamsFor = (api: Replay) => api.AllyTeams || []
export const playersFor = (api: Replay) =>
  teamsFor(api).flatMap((team) => team.Players || [])
export const playerName = (player: Player) => player.name || 'Unknown player'
export function rankedFor(api: Replay) {
  const value = api.gameSettings?.ranked_game
  if (value === true || value === 1 || value === '1') return 'Ranked'
  if (value === false || value === 0 || value === '0') return 'Unranked'
  return 'Unknown'
}
export function dimensionsFor(api: Replay) {
  const width = (api.Map?.width || 0) * 512,
    height = (api.Map?.height || 0) * 512
  return width > 0 && height > 0 ? { width, height } : null
}
export function colorFor(player?: Player) {
  const channels = player?.rgbColor && [
    player.rgbColor.r,
    player.rgbColor.g,
    player.rgbColor.b,
  ]
  return channels?.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ? `rgb(${channels.join(', ')})`
    : '#e6bc6a'
}
export function skillFor(player: Player) {
  const match = /^(?:\[\s*(-?\d+(?:\.\d+)?)\s*\]|(-?\d+(?:\.\d+)?))$/.exec(
    String(player.skill ?? '').trim(),
  )
  return match ? (match[1] ?? match[2]) : '—'
}
export function dateLabel(value?: string | null) {
  const date = new Date(value || '')
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
}
export function localDate(value?: string | null) {
  const date = new Date(value || '')
  return Number.isNaN(date.getTime())
    ? ''
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function timeLabel(seconds: number) {
  const n = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
}
