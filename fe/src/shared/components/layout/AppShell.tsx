import { type ReactNode } from 'react'

interface AppShellProps {
  children: ReactNode
}

export default function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] antialiased">
      {children}
    </div>
  )
}
