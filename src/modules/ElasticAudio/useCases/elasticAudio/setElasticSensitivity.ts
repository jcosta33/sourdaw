import { logger } from '#/infra/logger/appLogger';
import { executeAppAction } from '#/modules/Command/useCases';
import { clipSelectionStore, trackStore } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences, updatePreferences } from '#/modules/Preferences/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { elasticAudioStore, defaultElasticAudioState } from '../../stores/elasticAudio';

import { cancelTransientDetection, transientDetectionRevision } from './detectTransientsForClip';
import { elasticSensitivityDependencies } from './elasticSensitivityDependencies';
import { resolveElasticEditorTarget } from './resolveElasticEditorTarget';

const DEBOUNCE_MS = 150;
type PendingState = {
    timer: ReturnType<typeof setTimeout>;
    completion: ReturnType<typeof Promise.withResolvers<void>>;
    dispose: () => void;
    abort: () => void;
};
let pending: PendingState | undefined;
let inFlight: PendingState | undefined;
let generation = 0;

function currentTarget() {
    return resolveElasticEditorTarget(
        elasticAudioStore.value ?? defaultElasticAudioState,
        clipSelectionStore.value,
        trackStore.value
    );
}

function hasValidSource(buffer: AudioBuffer | undefined): boolean {
    return (
        buffer !== undefined &&
        Number.isFinite(buffer.sampleRate) &&
        buffer.sampleRate > 0 &&
        Number.isInteger(buffer.length) &&
        buffer.length > 0 &&
        Number.isInteger(buffer.numberOfChannels) &&
        buffer.numberOfChannels > 0
    );
}

function hasSameGeometry(
    buffer: AudioBuffer | undefined,
    sampleRate: number | undefined,
    frames: number | undefined,
    channels: number | undefined
): boolean {
    return buffer?.sampleRate === sampleRate && buffer?.length === frames && buffer?.numberOfChannels === channels;
}

function subscribeToOwnerChanges(invalidate: () => void): () => void {
    const subscriptions = [
        elasticAudioStore.subscribe(invalidate),
        clipSelectionStore.subscribe(invalidate),
        trackStore.subscribe(invalidate),
    ];
    let disposed = false;
    return () => {
        if (disposed) {
            return;
        }
        disposed = true;
        for (const unsubscribe of subscriptions) {
            unsubscribe();
        }
    };
}

export function setElasticSensitivity(sensitivity: number, signal?: AbortSignal): Promise<void> {
    const request = ++generation;
    const previous = pending;
    if (previous) {
        clearTimeout(previous.timer);
        previous.abort();
        previous.dispose();
        pending = undefined;
    }
    inFlight?.abort();
    inFlight?.dispose();
    const completion = previous?.completion ?? Promise.withResolvers<void>();
    const target = currentTarget();
    const openedClipId = elasticAudioStore.value?.openClipId ?? null;
    const clipType = target.clip?.type;
    const bufferId = target.clip?.audioBufferId;
    const buffer = clipType === 'audio' && bufferId ? audioBufferCache.get(bufferId) : undefined;
    const sampleRate = buffer?.sampleRate;
    const frames = buffer?.length;
    const channels = buffer?.numberOfChannels;
    const validSource = hasValidSource(buffer);
    let captureRootIdentity: () => string;
    let rootIdentity: string;
    try {
        const capture = elasticSensitivityDependencies.captureRootIdentity;
        if (!capture) {
            throw new Error('Elastic sensitivity root identity capture is not configured');
        }
        captureRootIdentity = capture;
        rootIdentity = captureRootIdentity();
    } catch (error) {
        updatePreferences({ patch: { elasticTransientSensitivity: sensitivity } });
        logger.error(error instanceof Error ? error : new Error('Transient detection failed', { cause: error }));
        notifyUser('Transient detection failed. Try again.', 'error');
        completion.resolve();
        return completion.promise;
    }
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
        abort();
    }
    if (validSource && target.clipId) {
        cancelTransientDetection(target.clipId);
    }
    const revision = target.clipId ? transientDetectionRevision(target.clipId) : 0;
    let invalidated = false;
    const matches = (): boolean => {
        const current = currentTarget();
        const liveBuffer = bufferId ? audioBufferCache.get(bufferId) : undefined;
        return (
            elasticSensitivityDependencies.captureRootIdentity === captureRootIdentity &&
            captureRootIdentity() === rootIdentity &&
            (elasticAudioStore.value?.openClipId ?? null) === openedClipId &&
            current.clipId === target.clipId &&
            current.trackId === target.trackId &&
            current.clip?.type === clipType &&
            current.clip?.audioBufferId === bufferId &&
            liveBuffer === buffer &&
            hasSameGeometry(liveBuffer, sampleRate, frames, channels)
        );
    };
    const invalidate = (): void => {
        if (!matches()) {
            invalidated = true;
            abort();
        }
    };
    const unsubscribe = subscribeToOwnerChanges(invalidate);
    const dispose = (): void => {
        unsubscribe();
        signal?.removeEventListener('abort', abort);
    };
    updatePreferences({ patch: { elasticTransientSensitivity: sensitivity } });
    if (validSource) {
        elasticAudioStore.update((state) => (state ? { ...state, detected: false } : state));
    }
    const scheduled: PendingState = {
        completion,
        dispose,
        abort,
        timer: setTimeout(() => {
            if (pending === scheduled) {
                pending = undefined;
            }
            inFlight = scheduled;
            void run();
        }, DEBOUNCE_MS),
    };
    async function run(): Promise<void> {
        try {
            if (
                !validSource ||
                !target.clipId ||
                invalidated ||
                controller.signal.aborted ||
                request !== generation ||
                !matches() ||
                transientDetectionRevision(target.clipId) !== revision
            ) {
                return;
            }
            const currentSensitivity =
                preferencesStore.value?.elasticTransientSensitivity ?? defaultPreferences.elasticTransientSensitivity;
            let committed = false;
            await executeAppAction(
                { type: 'detectTransients', payload: { clipId: target.clipId, sensitivity: currentSensitivity } },
                {
                    signal: controller.signal,
                    onCommitted: () => {
                        committed = true;
                    },
                }
            );
            if (invalidated || controller.signal.aborted || request !== generation || !matches()) {
                return;
            }
            if (!committed) {
                throw new Error('Transient detection completed without a committed mutation');
            }
            elasticAudioStore.update((state) => (state ? { ...state, detected: true } : state));
        } catch (error) {
            if (!controller.signal.aborted) {
                logger.error(
                    error instanceof Error ? error : new Error('Transient detection failed', { cause: error })
                );
                notifyUser('Transient detection failed. Try again.', 'error');
            }
        } finally {
            if (inFlight === scheduled) {
                inFlight = undefined;
            }
            dispose();
            completion.resolve();
        }
    }
    pending = scheduled;
    return completion.promise;
}
