export type RecordingFilterRecord = {
  player: string
  name: string
  done: string
  unit_kind: string
  seconds: number
}

// Shared by the table and the stable, non-time-filtered map dataset. Keeping
// this predicate in one place prevents the live preview and list disagreeing.
export function matchesRecordingFilter(
  row: RecordingFilterRecord,
  id: string,
  value: unknown,
) {
  if (id === 'seconds') return row.seconds <= Number(value)
  const search = String(value).toLowerCase()
  if (id === 'name') return row.name.toLowerCase().includes(search)
  if (id === 'player' || id === 'done' || id === 'unit_kind')
    return row[id].toLowerCase() === search
  return true
}
