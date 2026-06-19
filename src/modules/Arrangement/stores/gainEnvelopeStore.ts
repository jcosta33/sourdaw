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
