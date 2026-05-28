export default function Divider({ label = '또는' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-px bg-[var(--border)]" />
      <span className="text-xs text-[var(--text-disabled)]">{label}</span>
      <div className="flex-1 h-px bg-[var(--border)]" />
    </div>
  )
}
