import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Table({
  className,
  containerProps,
  ...props
}: ComponentProps<'table'> & { containerProps?: ComponentProps<'div'> }) {
  return (
    <div
      {...containerProps}
      className={cn('relative w-full overflow-auto', containerProps?.className)}
    >
      <table
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  )
}
export function TableHeader(props: ComponentProps<'thead'>) {
  return <thead className="[&_tr]:border-b" {...props} />
}
export function TableBody(props: ComponentProps<'tbody'>) {
  return <tbody className="[&_tr:last-child]:border-0" {...props} />
}
export function TableRow(props: ComponentProps<'tr'>) {
  return (
    <tr className="border-b transition-colors hover:bg-muted/50" {...props} />
  )
}
export function TableHead(props: ComponentProps<'th'>) {
  return (
    <th
      className="h-12 whitespace-nowrap px-3 text-left align-middle font-medium text-muted-foreground"
      {...props}
    />
  )
}
export function TableCell(props: ComponentProps<'td'>) {
  return <td className="p-3 align-middle" {...props} />
}
