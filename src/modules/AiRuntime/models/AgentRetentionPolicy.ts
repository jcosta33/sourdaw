/** Local retention bounds one owner enforces over the agent artifacts it stores. */
export type LocalRetentionPolicy = { maxCount: number; maxBytes: number | null; maxAgeMs: number | null };

const DAYS_30_MS = 30 * 24 * 60 * 60 * 1000;

/** Every stored field is bounded on its own — 128 KiB of text, 1 MiB of serialized batch — so run history needs no aggregate byte bound. */
export const AGENT_RUN_RETENTION_POLICY: LocalRetentionPolicy = {
    maxCount: 50,
    maxBytes: null,
    maxAgeMs: DAYS_30_MS,
};

/** A history group holds a prompt and action labels the validator already bounds, so no aggregate byte bound applies. */
export const AI_ACTION_HISTORY_RETENTION_POLICY: LocalRetentionPolicy = {
    maxCount: 50,
    maxBytes: null,
    maxAgeMs: DAYS_30_MS,
};

/** Chat messages live in memory only and are never persisted, so neither a byte bound nor an age bound applies. */
export const AGENT_CHAT_RETENTION_POLICY: LocalRetentionPolicy = {
    maxCount: 200,
    maxBytes: null,
    maxAgeMs: null,
};

/** A confirmation is resolved or superseded within the session that opened it, so no age bound applies. */
export const PENDING_ACTION_CONFIRMATION_RETENTION_POLICY: LocalRetentionPolicy = {
    maxCount: 20,
    maxBytes: 2 * 1024 * 1024 * 1024,
    maxAgeMs: null,
};
