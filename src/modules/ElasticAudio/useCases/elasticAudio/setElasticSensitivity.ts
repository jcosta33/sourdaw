import { logger } from '#/infra/logger/appLogger';
import { executeAppAction } from '#/modules/Command/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences, updatePreferences } from '#/modules/Preferences/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { elasticAudioStore } from '../../stores/elasticAudio';

import { captureElasticDetectionOwner } from './captureElasticDetectionOwner';
import { elasticSensitivityDependencies } from './elasticSensitivityDependencies';
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

function captureSensitivityOwner(sensitivity: number, signal?: AbortSignal) {
    try {
        if (!elasticSensitivityDependencies.captureRootIdentity) {
            throw new Error('Elastic sensitivity root identity capture is not configured');
        }
        return captureElasticDetectionOwner(elasticSensitivityDependencies, signal);
    } catch (error) {
        updatePreferences({ patch: { elasticTransientSensitivity: sensitivity } });
        logger.error(error instanceof Error ? error : new Error('Transient detection failed', { cause: error }));
        notifyUser('Transient detection failed. Try again.', 'error');
        return undefined;
    }
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
