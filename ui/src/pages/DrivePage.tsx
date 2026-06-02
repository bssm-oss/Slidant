import { useEffect } from 'react'
import DashboardLayout from '@/shared/components/layout/DashboardLayout'
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
  }, [loadProjects, navigate])

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full overflow-hidden">
        <DriveTopbar />
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Spinner size="lg" />
            </div>
          ) : (
            <div className="flex flex-col gap-8 px-4 py-5 sm:px-6 lg:px-8">
              {recent.length > 0 && (
                <section>
                  <div className="mb-4 flex items-end justify-between gap-3">
                    <div>
                      <h2 className="text-[15px] font-semibold text-[var(--text)]">최근 작업</h2>
                      <p className="mt-1 text-[12px] text-[var(--text-disabled)]">마지막으로 편집한 프레젠테이션</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {recent.map((ppt, i) => (
                      <PresentationCard key={ppt.id} presentation={ppt} index={i} />
                    ))}
                  </div>
                </section>
              )}
              <section>
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h2 className="text-[15px] font-semibold text-[var(--text)]">
                    모든 프레젠테이션
                  </h2>
                  <span className="shrink-0 rounded-full border border-[var(--border)] bg-white px-2.5 py-1 text-[12px] font-medium text-[var(--text-muted)]">
                    {all.length}개
                  </span>
                </div>
                {all.length === 0
                  ? (
                    <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-[var(--border-strong)] bg-white px-6 text-center">
                      <p className="text-sm font-medium text-[var(--text)]">프레젠테이션이 없습니다</p>
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
    </DashboardLayout>
  )
}
