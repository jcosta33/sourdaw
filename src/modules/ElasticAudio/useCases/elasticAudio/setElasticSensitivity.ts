import { elasticAudioStore, defaultElasticAudioState } from '../../stores/elasticAudio';

import { detectTransientsForClip } from './detectTransientsForClip';

const DEBOUNCE_MS = 150;

type PendingState = {
    timer: ReturnType<typeof setTimeout> | null;
    inFlight: Promise<void> | null;
    resolver: (() => void) | null;
};

const pending: PendingState = { timer: null, inFlight: null, resolver: null };

export function setElasticSensitivity(sensitivity: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, sensitivity));
    const current = elasticAudioStore.value ?? defaultElasticAudioState;
    elasticAudioStore.set({ ...current, sensitivity: clamped });

    if (pending.timer !== null) {
        clearTimeout(pending.timer);
        pending.timer = null;
    }

    if (!pending.inFlight) {
        pending.inFlight = new Promise<void>((resolve) => {
            pending.resolver = resolve;
        });
    }

    pending.timer = setTimeout(() => {
        pending.timer = null;
        const state = elasticAudioStore.value ?? defaultElasticAudioState;
        const clipId = state.openClipId;
        const resolver = pending.resolver;
        pending.inFlight = null;
        pending.resolver = null;
        if (clipId !== null) {
            detectTransientsForClip(clipId, state.sensitivity);
            elasticAudioStore.set({ ...state, detected: true });
        }
        if (resolver) {
            resolver();
        }
    }, DEBOUNCE_MS);

    return pending.inFlight;
}
