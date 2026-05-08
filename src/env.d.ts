/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Client-side Supabase
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ProcessEnv {
  // Server-side database
  readonly SUPABASE_DB_PASS: string;
  readonly SUPABASE_POOLER_CONNECTION_STRING: string;
  readonly SUPABASE_DIRECT_CONNECTION_STRING: string;
  readonly SUPABASE_PERSONAL_ACCESS_TOKEN: string;
  readonly SUPABASE_PROJECT_REF: string;
}

declare global {
  namespace NodeJS {
    interface ProcessEnv extends ProcessEnv {}
  }
}

declare module "vite/client" {
  interface ImportMetaEnv extends ImportMetaEnv {}
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export {};
