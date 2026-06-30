export const SIDECAR_PORT = parseInt((import.meta.env.VITE_LLM_SIDECAR_PORT as string | undefined) ?? '8847', 10);
export const BASE_URL = `http://127.0.0.1:${String(SIDECAR_PORT)}`;

// §67.4 — Wrapped in a holder so the module-level binding can't be
// reassigned from outside the file.
export const nativeEngineState = { ready: false };
