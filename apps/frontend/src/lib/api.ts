const configuredBaseUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";

export const apiUrl = (path: string) => `${configuredBaseUrl}${path}`;

export async function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers: { ...init?.headers },
  });
}
