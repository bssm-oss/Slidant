import { create } from 'zustand'
import { cn } from '@/shared/lib/utils'
import { CheckCircle, XCircle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info'
interface Toast { id: string; message: string; type: ToastType }
interface ToastStore {
  toasts: Toast[]
  push: (message: string, type?: ToastType) => void
  remove: (id: string) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (message, type = 'info') => {
    const id = Math.random().toString(36).slice(2)
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3000)
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

const icons = {
  success: <CheckCircle size={14} className="text-[var(--mint)]" />,
  error: <XCircle size={14} className="text-red-500" />,
  info: <Info size={14} className="text-[var(--accent)]" />,
}

const styles = {
  success: 'border-emerald-200 bg-[var(--mint-subtle)]',
  error: 'border-red-200 bg-red-50',
  info: 'border-purple-200 bg-[var(--accent-subtle)]',
}

function ToastItem({ toast }: { toast: Toast }) {
  const remove = useToastStore((s) => s.remove)
  return (
    <div className={cn(
      'flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] border shadow-[0_4px_16px_rgba(0,0,0,0.10)]',
      'text-sm text-[var(--text)] min-w-[240px] max-w-[320px]',
      'animate-in slide-in-from-bottom-2 fade-in duration-200',
      styles[toast.type],
    )}>
      {icons[toast.type]}
      <span className="flex-1 text-xs font-medium">{toast.message}</span>
      <button onClick={() => remove(toast.id)} className="text-[var(--text-disabled)] hover:text-[var(--text)] cursor-pointer">
        <X size={12} />
      </button>
    </div>
  )
}

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end">
      {toasts.map((t) => <ToastItem key={t.id} toast={t} />)}
    </div>
  )
}
