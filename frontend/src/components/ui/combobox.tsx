import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from './button'

export function Combobox({
  label,
  value,
  options,
  onChange,
  disabled = false,
  empty = 'All',
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  disabled?: boolean
  empty?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="field">
      <span className="text-muted-foreground">{label}</span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className="truncate">{value || empty}</span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-50 w-[var(--radix-popover-trigger-width)] min-w-48 rounded-md border bg-popover p-1 shadow-lg"
          >
            <Command label={label}>
              <Command.Input
                placeholder={`Search ${label.toLowerCase()}…`}
                className="h-10 w-full border-b bg-transparent px-2 text-sm outline-none"
              />
              <Command.List className="max-h-64 overflow-y-auto p-1">
                <Command.Empty className="p-3 text-sm">
                  No matching options.
                </Command.Empty>
                {['', ...options].map((option) => (
                  <Command.Item
                    key={option}
                    value={option || empty}
                    onSelect={() => {
                      onChange(option)
                      setOpen(false)
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm data-[selected=true]:bg-accent"
                  >
                    <Check
                      className={`size-4 ${value === option ? 'opacity-100' : 'opacity-0'}`}
                    />
                    {option || empty}
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
