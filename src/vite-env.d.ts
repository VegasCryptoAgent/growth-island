/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STRIPE_MASTERCLASS?: string;
  readonly VITE_STRIPE_MASTERCLASS_CONSULT?: string;
  readonly VITE_STRIPE_AI_WORKSHOP?: string;
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
