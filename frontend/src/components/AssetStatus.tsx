import { Download, RefreshCw } from 'lucide-react'
import type { Library } from '@/hooks/use-library'
import { errorMessage } from '@/lib/utils'
import { Button } from './ui/button'

export function AssetStatus({
  library,
  url,
}: {
  library: Library
  url?: string
}) {
  const { assets, refreshAssets } = library
  const data = assets.data
  const refs = url ? data?.entries[url] : null
  const states = data
    ? url
      ? [
          refs?.map ? ([refs.map, data.maps[refs.map]] as const) : null,
          ...(refs?.units || []).map(
            (name) => [name, data.units[name]] as const,
          ),
        ].filter((item) => item !== null)
      : [...Object.entries(data.maps), ...Object.entries(data.units)]
    : []
  const missing = states.filter(([, item]) => item?.state === 'missing').length
  const failed = states.filter(([, item]) => item?.state === 'failed')
  const result = refreshAssets.data
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={missing ? 'default' : 'outline'}
          size="sm"
          disabled={refreshAssets.isPending}
          onClick={() => refreshAssets.mutate()}
        >
          {refreshAssets.isPending ? (
            <RefreshCw className="animate-spin" />
          ) : (
            <Download />
          )}{' '}
          {refreshAssets.isPending ? 'Downloading assets…' : 'Refresh assets'}
        </Button>
        <span className="text-muted-foreground">
          {assets.isPending
            ? 'Checking local cache…'
            : `${missing} missing · ${failed.length} unavailable`}
        </span>
      </div>
      {(assets.error || refreshAssets.error) && (
        <p role="alert" className="text-destructive">
          {errorMessage(assets.error || refreshAssets.error)}{' '}
          {assets.error && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void assets.refetch()}
            >
              Retry check
            </Button>
          )}
        </p>
      )}
      {failed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-destructive">
            Unavailable assets
          </summary>
          <ul className="mt-2 space-y-1">
            {failed.map(([name, state]) => (
              <li key={name}>
                {name}: {state?.error || 'Download failed'}
              </li>
            ))}
          </ul>
        </details>
      )}
      {result && !refreshAssets.isPending && (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer">
            {result.refreshed.length} maps, {result.units_refreshed.length}{' '}
            icons refreshed; {result.failed.length + result.units_failed.length}{' '}
            failed.
          </summary>
          <p>Previous cached assets are kept when downloads fail.</p>
          {[
            ...result.failed.map((item) => `${item.map}: ${item.error}`),
            ...result.units_failed.map((item) => `${item.unit}: ${item.error}`),
          ].map((item) => (
            <p key={item}>{item}</p>
          ))}
          {result.status_warning && <p>{result.status_warning}</p>}
        </details>
      )}
    </div>
  )
}
