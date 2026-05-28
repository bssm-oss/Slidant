import { AppShell } from '@/shared/components/layout'
import DriveTopbar from '@/features/drive/components/DriveTopbar'
import PresentationCard from '@/features/drive/components/PresentationCard'
import PresentationTable from '@/features/drive/components/PresentationTable'
import { useDriveStore } from '@/features/drive/store/driveStore'

export default function DrivePage() {
  const filteredPresentations = useDriveStore((s) => s.filteredPresentations())
  const recent = filteredPresentations.slice(0, 4)

  return (
    <AppShell>
      <div className="flex flex-col h-screen overflow-hidden">
        <DriveTopbar />
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-8">
            {recent.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-[var(--text-muted)] mb-4">최근 작업</h2>
                <div className="grid grid-cols-4 gap-4">
                  {recent.map((ppt, i) => (
                    <PresentationCard key={ppt.id} presentation={ppt} index={i} />
                  ))}
                </div>
              </section>
            )}
            <section>
              <h2 className="text-sm font-semibold text-[var(--text-muted)] mb-4">
                모든 프레젠테이션
                <span className="ml-2 text-xs font-normal text-[var(--text-disabled)]">{filteredPresentations.length}개</span>
              </h2>
              {filteredPresentations.length === 0
                ? <p className="text-sm text-[var(--text-disabled)] py-8 text-center">검색 결과가 없습니다</p>
                : <PresentationTable presentations={filteredPresentations} />
              }
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
