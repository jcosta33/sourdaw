import { logger } from '#/infra/logger/appLogger';
import { clipSelectionStore, trackStore } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences, updatePreferences } from '#/modules/Preferences/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { elasticAudioStore, defaultElasticAudioState } from '../../stores/elasticAudio';

import { cancelTransientDetection } from './cancelTransientDetection';
import { elasticSensitivityDependencies } from './elasticSensitivityDependencies';
import { resolveElasticEditorTarget } from './resolveElasticEditorTarget';
import { transientDetectionLifecycle } from './transientDetectionLifecycle';
import { transientDetectionRevision } from './transientDetectionRevision';

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

function hasDetectionAcknowledgment(committed: boolean, clipId: string, revision: number): boolean {
    if (committed) {
        return true;
    }
    // The registered Detect takes its own revision once; another invocation cannot acknowledge this one.
    const unchanged = transientDetectionLifecycle.readCompletion(clipId, revision + 1);
    return unchanged?.status === 'unchanged';
}

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

function captureSensitivityOwner(sensitivity: number, signal?: AbortSignal) {
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
        return undefined;
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
    return {
        clipId: target.clipId,
        validSource,
        signal: controller.signal,
        revision,
        matches,
        isInvalidated: () => invalidated,
        dispose,
        abort,
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
    const owner = captureSensitivityOwner(sensitivity, signal);
    if (!owner) {
        completion.resolve();
        return completion.promise;
    }
    updatePreferences({ patch: { elasticTransientSensitivity: sensitivity } });
    if (owner.validSource) {
        elasticAudioStore.update((state) => (state ? { ...state, detected: false } : state));
    }
    const scheduled: PendingState = {
        completion,
        dispose: owner.dispose,
        abort: owner.abort,
        timer: setTimeout(() => {
            if (pending === scheduled) {
                pending = undefined;
            }
            inFlight = scheduled;
            void run();
        }, DEBOUNCE_MS),
    };
    const run = async (): Promise<void> => {
        try {
            if (
                !owner.validSource ||
                !owner.clipId ||
                owner.isInvalidated() ||
                owner.signal.aborted ||
                request !== generation ||
                !owner.matches() ||
                transientDetectionRevision(owner.clipId) !== owner.revision
            ) {
                return;
            }
            const currentSensitivity =
                preferencesStore.value?.elasticTransientSensitivity ?? defaultPreferences.elasticTransientSensitivity;
            let committed = false;
            await executeAppAction(
                { type: 'detectTransients', payload: { clipId: owner.clipId, sensitivity: currentSensitivity } },
                {
                    signal: owner.signal,
                    onCommitted: () => {
                        committed = true;
                    },
                }
            );
            if (owner.isInvalidated() || owner.signal.aborted || request !== generation || !owner.matches()) {
                return;
            }
            if (!hasDetectionAcknowledgment(committed, owner.clipId, owner.revision)) {
                throw new Error('Transient detection completed without a committed mutation');
            }
            elasticAudioStore.update((state) => (state ? { ...state, detected: true } : state));
        } catch (error) {
            if (!owner.signal.aborted) {
                logger.error(
                    error instanceof Error ? error : new Error('Transient detection failed', { cause: error })
                );
                notifyUser('Transient detection failed. Try again.', 'error');
            }
        } finally {
            if (inFlight === scheduled) {
                inFlight = undefined;
            }
            owner.dispose();
            completion.resolve();
        }
    };
    pending = scheduled;
    return completion.promise;
}
