/// <reference types="vite/client" />

declare module "vite/client" {
  interface ImportMetaEnv extends ImportMetaEnv {}
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export {};
