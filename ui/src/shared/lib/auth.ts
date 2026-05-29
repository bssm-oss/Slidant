import { api, clearToken, setToken } from './apiClient'

interface SignupRequest { email: string; password: string }
interface LoginRequest { email: string; password: string }
interface TokenResponse { access_token: string; token_type: string }
interface UserResponse { id: string; email: string; created_at: string }

export async function signup(data: SignupRequest): Promise<UserResponse> {
  return api.post<UserResponse>('/auth/signup', data)
}

export async function login(data: LoginRequest): Promise<void> {
  const res = await api.post<TokenResponse>('/auth/login', data)
  setToken(res.access_token)
}

export function logout(): void {
  clearToken()
}

export async function getMe(): Promise<UserResponse> {
  return api.get<UserResponse>('/users/me')
}

export function isLoggedIn(): boolean {
  return !!localStorage.getItem('access_token')
}
