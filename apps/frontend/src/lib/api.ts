// The production frontend is hosted separately from the Worker API. An explicit
// fallback keeps authentication and assets on the API origin when a deployment
// environment variable was not configured.
const customApiOrigin = "https://api.devlog.bysaiful.site";
const legacyWorkersOrigin = "https://devlog-api.saifulanik.workers.dev";
const configuredApiOrigin = import.meta.env.VITE_API_URL?.replace(/\/$/, "");
const configuredBaseUrl = configuredApiOrigin === legacyWorkersOrigin
  ? customApiOrigin
  : configuredApiOrigin ?? (import.meta.env.PROD ? customApiOrigin : "");

export const apiUrl = (path: string) => `${configuredBaseUrl}${path}`;

export async function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers: { ...init?.headers },
  });
}
