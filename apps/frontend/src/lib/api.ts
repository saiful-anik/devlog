// The production frontend is hosted separately from the Worker API. An explicit
// fallback keeps authentication and assets on the API origin when a deployment
// environment variable was not configured.
const configuredBaseUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, "")
  ?? (import.meta.env.PROD ? "https://api.devlog.bysaiful.site" : "");

export const apiUrl = (path: string) => `${configuredBaseUrl}${path}`;

export async function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers: { ...init?.headers },
  });
}
