import { useEffect } from 'react'
import { AppShell } from '@/shared/components/layout'
import DriveTopbar from '@/features/drive/components/DriveTopbar'
import PresentationCard from '@/features/drive/components/PresentationCard'
import PresentationTable from '@/features/drive/components/PresentationTable'
import { useDriveStore } from '@/features/drive/store/driveStore'
import { Spinner } from '@/shared/components/ui'
import { isLoggedIn } from '@/shared/lib/auth'
import { useNavigate } from 'react-router-dom'

export default function DrivePage() {
  const { filteredPresentations, loadProjects, loading } = useDriveStore()
  const navigate = useNavigate()
  const all = filteredPresentations()
  const recent = all.slice(0, 4)

  useEffect(() => {
    if (!isLoggedIn()) { navigate('/login'); return }
    loadProjects()
  }, [])

  return (
    <AppShell>
      <div className="flex flex-col h-screen overflow-hidden">
        <DriveTopbar />
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Spinner size="lg" />
            </div>
          ) : (
            <div className="px-10 py-8 flex flex-col gap-10">
              {recent.length > 0 && (
                <section>
                  <h2 className="text-base font-bold text-[var(--text)] mb-5">최근 작업</h2>
                  <div className="grid grid-cols-4 gap-5">
                    {recent.map((ppt, i) => (
                      <PresentationCard key={ppt.id} presentation={ppt} index={i} />
                    ))}
                  </div>
                </section>
              )}
              <section>
                <h2 className="text-base font-bold text-[var(--text)] mb-5">
                  모든 프레젠테이션
                  <span className="ml-2 text-sm font-normal text-[var(--text-disabled)]">{all.length}개</span>
                </h2>
                {all.length === 0
                  ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3">
                      <p className="text-[var(--text-muted)]">프레젠테이션이 없습니다</p>
                      <p className="text-sm text-[var(--text-disabled)]">"새 프레젠테이션" 버튼으로 시작하세요</p>
                    </div>
                  )
                  : <PresentationTable presentations={all} />
                }
              </section>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
