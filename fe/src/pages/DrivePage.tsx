import { AppShell } from '@/shared/components/layout'
import DriveTopbar from '@/features/drive/components/DriveTopbar'
import PresentationCard from '@/features/drive/components/PresentationCard'
import PresentationTable from '@/features/drive/components/PresentationTable'
import { mockPresentations } from '@/shared/mock/presentations'

const RECENT_COUNT = 4

export default function DrivePage() {
  const recent = mockPresentations.slice(0, RECENT_COUNT)
  const all = mockPresentations

  return (
    <AppShell>
      <div className="flex flex-col h-screen overflow-hidden">
        <DriveTopbar />

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-8">

            {/* 최근 작업 */}
            <section>
              <h2 className="text-sm font-semibold text-[var(--text-muted)] mb-4">최근 작업</h2>
              <div className="grid grid-cols-4 gap-4">
                {recent.map((ppt) => (
                  <PresentationCard key={ppt.id} presentation={ppt} />
                ))}
              </div>
            </section>

            {/* 모든 프레젠테이션 */}
            <section>
              <h2 className="text-sm font-semibold text-[var(--text-muted)] mb-4">
                모든 프레젠테이션
                <span className="ml-2 text-xs font-normal text-[var(--text-disabled)]">{all.length}개</span>
              </h2>
              <PresentationTable presentations={all} />
            </section>

          </div>
        </div>
      </div>
    </AppShell>
  )
}
