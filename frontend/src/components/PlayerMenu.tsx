import * as Dropdown from '@radix-ui/react-dropdown-menu'

export function PlayerMenu({
  name,
  onFilter,
}: {
  name: string
  onFilter: (name: string) => void
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        className="rounded-sm text-left text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Actions for ${name}`}
      >
        {name}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          sideOffset={4}
          className="z-50 min-w-36 rounded-md border bg-popover p-1 shadow-lg"
        >
          <Dropdown.Item
            asChild
            className="block rounded-sm px-3 py-2 text-sm outline-none focus:bg-accent"
          >
            <a
              href={`https://bar-rts.com/replays?players=${encodeURIComponent(name)}`}
              target="_blank"
              rel="noreferrer"
            >
              View on BAR
            </a>
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() => onFilter(name)}
            className="cursor-pointer rounded-sm px-3 py-2 text-sm outline-none focus:bg-accent"
          >
            Filter library
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}
