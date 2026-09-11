const configuredBaseUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";

export const apiUrl = (path: string) => `${configuredBaseUrl}${path}`;
