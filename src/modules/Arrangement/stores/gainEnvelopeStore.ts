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

export function deleteEnvelope(clipId: string): void {
    const current = gainEnvelopeStore.value;
    if (!current || !(clipId in current.envelopes)) {
        return;
    }
    const { [clipId]: _dropped, ...rest } = current.envelopes;
    gainEnvelopeStore.set({ envelopes: rest });
}

export function getAllEnvelopes(): ClipGainEnvelope[] {
    const current = gainEnvelopeStore.value;
    if (!current) {
        return [];
    }
    return Object.values(current.envelopes);
}

/** Test-only: reset the store to its empty default. */
export function __resetGainEnvelopesForTest(): void {
    gainEnvelopeStore.set(defaultGainEnvelopeStoreState);
}
