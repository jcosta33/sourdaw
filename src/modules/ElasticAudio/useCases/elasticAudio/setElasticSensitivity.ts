import { executeAppAction } from '#/modules/Command/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences, updatePreferences } from '#/modules/Preferences/useCases';

import { elasticAudioStore } from '../../stores/elasticAudio';

import { cancelTransientDetection, transientDetectionRevision } from './detectTransientsForClip';

const DEBOUNCE_MS = 150;
let generation = 0;
type Waiter = { resolve: () => void; reject: (error: unknown) => void };
let pending: { timer: ReturnType<typeof setTimeout>; waiters: Waiter[] } | null = null;

export function setElasticSensitivity(sensitivity: number, signal?: AbortSignal): Promise<void> {
    updatePreferences({ patch: { elasticTransientSensitivity: sensitivity } });
    const request = ++generation;
    const clipId = elasticAudioStore.value?.openClipId;
    if (clipId) {
        cancelTransientDetection(clipId);
        elasticAudioStore.update((state) => (state ? { ...state, detected: false } : state));
    }
    const revision = clipId ? transientDetectionRevision(clipId) : 0;
    const waiters = pending?.waiters ?? [];
    if (pending) { clearTimeout(pending.timer); }
    return new Promise<void>((resolve, reject) => {
        waiters.push({ resolve, reject });
        const finish = (): void => {
            for (const waiter of waiters) { waiter.resolve(); }
        };
        const fail = (error: unknown): void => {
            for (const waiter of waiters) { waiter.reject(error); }
        };
        const timer = setTimeout(() => {
            pending = null;
            if (!clipId) {
                finish();
                return;
            }
            if (
                elasticAudioStore.value?.openClipId !== clipId ||
                request !== generation ||
                signal?.aborted ||
                transientDetectionRevision(clipId) !== revision
            ) {
                fail(new DOMException('Transient detection was cancelled', 'AbortError'));
                return;
            }
            const currentSensitivity =
                preferencesStore.value?.elasticTransientSensitivity ?? defaultPreferences.elasticTransientSensitivity;
            void executeAppAction(
                {
                    type: 'detectTransients',
                    payload: { clipId, sensitivity: currentSensitivity },
                },
                { signal }
            ).then(() => {
                if (request === generation && elasticAudioStore.value?.openClipId === clipId) {
                    elasticAudioStore.update((state) => (state ? { ...state, detected: true } : state));
                }
                finish();
            }, fail);
        }, DEBOUNCE_MS);
        pending = { timer, waiters };
    });
}
