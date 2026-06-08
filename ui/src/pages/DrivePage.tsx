import { useEffect, useState } from 'react'
import DashboardLayout from '@/shared/components/layout/DashboardLayout'
import DriveTopbar from '@/features/drive/components/DriveTopbar'
import PresentationCard from '@/features/drive/components/PresentationCard'
import PresentationTable from '@/features/drive/components/PresentationTable'
import { useDriveStore } from '@/features/drive/store/driveStore'
import { Spinner } from '@/shared/components/ui'
import { isLoggedIn } from '@/shared/lib/auth'
import { useNavigate } from 'react-router-dom'
import { Sparkles, ArrowRight } from 'lucide-react'

export default function DrivePage() {
  const { filteredPresentations, loadProjects, loading, createPresentation } = useDriveStore()
  const navigate = useNavigate()
  const all = filteredPresentations()
  const recent = all.slice(0, 20)

  const [prompt, setPrompt] = useState('')
  const [creating, setCreating] = useState(false)

  const handleQuickCreate = async () => {
    if (!prompt.trim() || creating) return
    setCreating(true)
    try {
      const newId = await createPresentation()
      localStorage.setItem(`slidant_initial_prompt_${newId}`, prompt.trim())
      navigate(`/edit/${newId}`)
    } catch {
      setCreating(false)
    }
  }

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
            <div className="flex flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
              {/* 히어로 프롬프트 섹션 */}
              <div className="px-0 pt-2 pb-0">
                <div className="max-w-2xl">
                  <h2 className="text-[22px] font-bold text-[var(--text)] mb-1">무엇을 만들까요?</h2>
                  <p className="text-[13px] text-[var(--text-muted)] mb-4">주제를 입력하면 AI가 프레젠테이션을 생성합니다</p>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={prompt}
                        onChange={e => setPrompt(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleQuickCreate()}
                        placeholder="예: 부산 여행 소개 PPT 5장, 분기별 매출 현황 보고서..."
                        className="w-full h-12 pl-4 pr-4 rounded-[12px] border border-[var(--border)] bg-white text-[14px] text-[var(--text)] placeholder-[var(--text-disabled)] focus:outline-none focus:border-[var(--accent)] transition-colors shadow-sm"
                      />
                    </div>
                    <button
                      onClick={handleQuickCreate}
                      disabled={!prompt.trim() || creating}
                      className="flex items-center gap-2 px-5 h-12 rounded-[12px] bg-[linear-gradient(135deg,#2563EB,#0EA5E9)] text-white text-[14px] font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity shadow-md shrink-0"
                    >
                      {creating ? <span className="animate-spin">⏳</span> : <Sparkles size={16} />}
                      {creating ? '생성 중...' : '생성'}
                      {!creating && <ArrowRight size={14} />}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {['AI 트렌드 분석', '팀 프로젝트 발표', '제품 소개서', '주간 보고서'].map(s => (
                      <button
                        key={s}
                        onClick={() => setPrompt(s + ' PPT 만들어줘')}
                        className="px-3 py-1 text-[11px] text-[var(--text-muted)] bg-[var(--bg-muted)] rounded-full hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {recent.length > 0 && (
                <section>
                  <div className="mb-4 flex items-end justify-between gap-3">
                    <div>
                      <h2 className="text-[15px] font-semibold text-[var(--text)]">최근 작업</h2>
                      <p className="mt-1 text-[12px] text-[var(--text-disabled)]">마지막으로 편집한 프레젠테이션</p>
                    </div>
                  </div>
                  <div className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {recent.map((ppt, i) => (
                      <div key={ppt.id} className="w-[260px] shrink-0">
                        <PresentationCard presentation={ppt} index={i} />
                      </div>
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
