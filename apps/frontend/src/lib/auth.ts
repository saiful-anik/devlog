import { apiUrl } from "@/lib/api";

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
  const result = await response.json() as { data?: AuthSession };
  return result.data ?? null;
}

export async function isAuthenticated() { return Boolean(await getSession()); }

export function signInWithGitHub(redirectPath = "/") {
  const returnTo = new URL(redirectPath, window.location.origin);
  window.location.assign(`${apiUrl("/auth/github")}?returnTo=${encodeURIComponent(returnTo.toString())}`);
}

export async function logout() { await fetch(apiUrl("/auth/signout"), { method: "POST", credentials: "include" }); }
