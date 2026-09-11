export interface AuthSession {
  id: string;
  name: string;
  provider: "github";
  isGuest: boolean;
  createdAt: string;
}

export async function getSession(): Promise<AuthSession | null> {
  const response = await fetch("/auth/session", { credentials: "include" });
  if (!response.ok) return null;
  const result = await response.json();
  if (!result.data) return null;
  return { id: result.data.id, name: result.data.name || result.data.login, provider: "github", isGuest: false, createdAt: new Date().toISOString() };
}

export async function isAuthenticated() { return Boolean(await getSession()); }

export async function signInWithGitHub(redirectPath = "/") {
  window.location.assign(`/auth/github?next=${encodeURIComponent(redirectPath)}`);
}

export async function logout() {
  await fetch("/auth/logout", { method: "POST", credentials: "include" });
}
