export interface AuthSession {
  id: string;
  name: string;
  provider: "github";
  isGuest: boolean;
  createdAt: string;
}

export async function getSession(): Promise<AuthSession | null> {
  const response = await fetch(apiUrl("/auth/session"), { credentials: "include" });
  if (!response.ok) return null;
  const result = await response.json();
  if (!result.data) return null;
  return { id: result.data.id, name: result.data.name || result.data.login, provider: "github", isGuest: false, createdAt: new Date().toISOString() };
}

export async function isAuthenticated() { return Boolean(await getSession()); }

export async function signInWithGitHub(redirectPath = "/") {
  const next = new URL(redirectPath, window.location.origin).toString();
  window.location.assign(apiUrl(`/auth/github?next=${encodeURIComponent(next)}`));
}

export async function logout() {
  await fetch(apiUrl("/auth/logout"), { method: "POST", credentials: "include" });
}
import { apiUrl } from "@/lib/api";
