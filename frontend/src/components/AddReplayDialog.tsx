import { useState } from 'react'
import type { Library } from '@/hooks/use-library'
import { replayUrlSchema } from '@/lib/schemas'
import { errorMessage } from '@/lib/utils'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'

export function AddReplayDialog({
  open,
  onOpenChange,
  library,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  library: Library
  onCreated: (url: string) => void
}) {
  const [url, setUrl] = useState('')
  const [remarks, setRemarks] = useState('')
  const [order, setOrder] = useState('')
  const [error, setError] = useState('')
  const create = async () => {
    const result = replayUrlSchema.safeParse(url)
    if (!result.success) {
      setError(result.error.issues[0].message)
      return
    }
    setError('')
    try {
      const created = await library.create.mutateAsync({
        replay_url: result.data,
        remarks,
        build_order: order,
      })
      onCreated(created.replay_url)
      onOpenChange(false)
      setUrl('')
      setRemarks('')
      setOrder('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!library.create.isPending) {
          setError('')
          onOpenChange(value)
        }
      }}
    >
      <DialogContent>
        <DialogTitle>Add a replay</DialogTitle>
        <DialogDescription>
          Fetch the full BAR replay snapshot once and save it in your local
          library.
        </DialogDescription>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <div className="field">
            <Label htmlFor="replay-url">Replay URL</Label>
            <Input
              id="replay-url"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://bar-rts.com/replays/…"
            />
          </div>
          <div className="field">
            <Label htmlFor="new-remarks">Remarks (optional)</Label>
            <Textarea
              id="new-remarks"
              value={remarks}
              maxLength={200_000}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
          <div className="field">
            <Label htmlFor="new-order">Build order (optional)</Label>
            <Textarea
              id="new-order"
              value={order}
              maxLength={200_000}
              onChange={(e) => setOrder(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={library.create.isPending}
            className="w-full"
          >
            {library.create.isPending
              ? 'Fetching BAR API…'
              : 'Fetch API & create entry'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
