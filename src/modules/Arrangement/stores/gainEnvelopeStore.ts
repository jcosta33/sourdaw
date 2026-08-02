/**
 * Clip gain envelope store.
 *
 * §197.1 — previously a bare module-level \`Map<string, ClipGainEnvelope>\`
 * with no subscription mechanism, forcing the inspector panel to use a
 * local \`envKey\` counter that only tracked in-component mutations (undo,
 * redo, collab sync, and external actions all left the UI stale). Now a
 * proper \`Store<Record<clipId, ClipGainEnvelope>>\` that components can
 * subscribe to via \`useStore\`.
 */
import { createStore } from '#/infra/store/createStore';

export type GainEnvelopePoint = {
    id: string;
    /** Relative to clip start. */
    beatOffset: number;
    /** -inf to +12 dB. */
    gainDb: number;
};

export type ClipGainEnvelope = {
    clipId: string;
    points: GainEnvelopePoint[];
    enabled: boolean;
};

export type GainEnvelopeStoreState = {
    envelopes: Record<string, ClipGainEnvelope>;
};

export const defaultGainEnvelopeStoreState: GainEnvelopeStoreState = { envelopes: {} };

export const gainEnvelopeStore = createStore<GainEnvelopeStoreState>({
    initialData: defaultGainEnvelopeStoreState,
});

// ── Imperative helpers (kept so callers that mutate via the use cases
// ── don't need to each know how to read/write the store shape) ────────

export function getEnvelope(clipId: string): ClipGainEnvelope | undefined {
    return gainEnvelopeStore.value?.envelopes[clipId];
}

export function setEnvelope(clipId: string, envelope: ClipGainEnvelope): void {
    const current = gainEnvelopeStore.value ?? defaultGainEnvelopeStoreState;
    gainEnvelopeStore.set({
        envelopes: { ...current.envelopes, [clipId]: envelope },
    });
}

export function getAllEnvelopes(): ClipGainEnvelope[] {
    const current = gainEnvelopeStore.value;
    if (!current) {
        return [];
    }
    return Object.values(current.envelopes);
}

/** Replace every envelope at once — the project-load entry point. */
export function setAllEnvelopes(envelopes: Record<string, ClipGainEnvelope>): void {
    gainEnvelopeStore.set({ envelopes });
}

function isGainEnvelopePoint(value: unknown): value is GainEnvelopePoint {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!('id' in value) || typeof value.id !== 'string') {
        return false;
    }
    if (!('beatOffset' in value) || typeof value.beatOffset !== 'number' || !Number.isFinite(value.beatOffset)) {
        return false;
    }
    return 'gainDb' in value && typeof value.gainDb === 'number' && Number.isFinite(value.gainDb);
}

function isClipGainEnvelope(value: unknown): value is ClipGainEnvelope {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!('clipId' in value) || typeof value.clipId !== 'string' || value.clipId.length === 0) {
        return false;
    }
    if (!('enabled' in value) || typeof value.enabled !== 'boolean') {
        return false;
    }
    if (!('points' in value) || !Array.isArray(value.points)) {
        return false;
    }
    return value.points.every(isGainEnvelopePoint);
}

/**
 * Decode persisted clip gain envelopes from a project file into the store's
 * `clipId`-keyed shape. An envelope that does not decode is dropped: the clip
 * then plays at its own clip gain, which is what a clip with no envelope does.
 */
export function sanitizeClipGainEnvelopes(value: unknown): Record<string, ClipGainEnvelope> {
    if (!Array.isArray(value)) {
        return {};
    }

    const envelopes: Record<string, ClipGainEnvelope> = {};
    for (const candidate of value) {
        if (!isClipGainEnvelope(candidate)) {
            continue;
        }
        envelopes[candidate.clipId] = {
            clipId: candidate.clipId,
            enabled: candidate.enabled,
            points: candidate.points.map((point) => ({
                id: point.id,
                beatOffset: point.beatOffset,
                gainDb: point.gainDb,
            })),
        };
    }
    return envelopes;
}

/** Drop the gain envelope keyed by a clip id (e.g. on clip removal). */
export function removeEnvelope(clipId: string): void {
    const current = gainEnvelopeStore.value ?? defaultGainEnvelopeStoreState;
    if (!(clipId in current.envelopes)) {
        return;
    }
    const { [clipId]: _removed, ...rest } = current.envelopes;
    gainEnvelopeStore.set({ envelopes: rest });
}

/**
 * Test-only: reset the store to its empty default.
 *
 * Guarded behind `import.meta.env.MODE` so it cannot mutate the live store in a
 * production build — under Vitest `MODE` is `'test'`. Exported (rather than
 * moved to a test helper) so the existing `*.spec.ts` callers keep working.
 */
export function __resetGainEnvelopesForTest(): void {
    if (import.meta.env.MODE !== 'test') {
        return;
    }
    gainEnvelopeStore.set(defaultGainEnvelopeStoreState);
}
