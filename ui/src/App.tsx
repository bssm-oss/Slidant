import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import EditPage from '@/pages/EditPage'
import DrivePage from '@/pages/DrivePage'
import LoginPage from '@/pages/LoginPage'
import SignupPage from '@/pages/SignupPage'
import AgentFullPage from '@/pages/AgentFullPage'
import AgentsPage from '@/pages/AgentsPage'
import ToastContainer from '@/shared/components/ui/Toast'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/drive" replace />} />
          <Route path="/drive" element={<DrivePage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/edit/:id" element={<EditPage />} />
          <Route path="/edit/:id/agent" element={<AgentFullPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
        </Routes>
      </BrowserRouter>
      <ToastContainer />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}
