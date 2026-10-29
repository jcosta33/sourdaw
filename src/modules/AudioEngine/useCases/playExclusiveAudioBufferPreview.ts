import { logger } from '#/infra/logger/appLogger';
import { runAllEffects } from '#/utils/runEffects';

import { type AudioPreviewIntent } from '../models/AudioPreviewIntent';

import { audioEngine } from './engineAccess/getAudioContext';
import { nativeLiveGraphSession } from './livePlayback/nativeLiveGraphSessionState';
import { reconcileNativeAuditionMonitoring } from './livePlayback/reconcileNativeAuditionMonitoring';
import { playAudioBufferPreview } from './playAudioBufferPreview';

// A source whose teardown threw is not proof of silence. Keep both programme
// gates closed in that context; only a fresh context can discard that uncertainty.
const unsafeOutputContexts = new WeakSet<AudioContext>();

type ExclusiveInput = { buffer: AudioBuffer; gain: number; isCurrent: () => boolean; onEnded: () => void };
type ExclusiveOperation = {
    input: ExclusiveInput;
    owner: symbol;
    acquisition: AbortController;
    intent: AudioPreviewIntent | null;
    playback: ReturnType<typeof playAudioBufferPreview>;
    stopped: boolean;
    restoration: Promise<void> | null;
    invalidate: () => void;
};
const report = (error: unknown) => logger.warn(new Error('Retained audition listening failed', { cause: error }));

function current(operation: ExclusiveOperation): boolean {
    return (
        !operation.stopped &&
        operation.intent?.isCurrent() === true &&
        operation.input.isCurrent() &&
        !unsafeOutputContexts.has(audioEngine.context)
    );
}

function stopExclusive(operation: ExclusiveOperation): Promise<void> {
    if (operation.restoration !== null) return operation.restoration;
    // Publish settlement before abort/ended callbacks can stop us reentrantly.
    // Every caller then waits for this same real restoration, never an idle no-op.
    const settled = Promise.withResolvers<void>();
    operation.restoration = settled.promise;
    audioEngine.holdAudioPreviewRestoration(operation.restoration);
    operation.stopped = true;
    operation.acquisition.abort();
    if (nativeLiveGraphSession.auditionInvalidation === operation.invalidate)
        nativeLiveGraphSession.auditionInvalidation = null;
    try {
        runAllEffects([() => operation.playback?.stop(), () => operation.intent?.release()]);
    } catch (error) {
        unsafeOutputContexts.add(audioEngine.context);
        settled.reject(error);
        return operation.restoration;
    }
    if (unsafeOutputContexts.has(audioEngine.context)) {
        settled.reject(new Error('Audition source cleanup failed. Reload to restore listening.'));
        return operation.restoration;
    }
    if (nativeLiveGraphSession.auditionOwner !== operation.owner) {
        settled.resolve();
        return operation.restoration;
    }
    nativeLiveGraphSession.auditionOwner = null;
    nativeLiveGraphSession.auditionRestorationOwner = operation.owner;
    const release = new AbortController();
    void reconcileNativeAuditionMonitoring({
        signal: release.signal,
        isCurrent: () =>
            nativeLiveGraphSession.auditionOwner === null &&
            nativeLiveGraphSession.auditionRestorationOwner === operation.owner,
        restoreWebProgramme: () => audioEngine.setAudioPreviewProgrammeSuppressed(false),
    }).then(() => settled.resolve(), settled.reject);
    return operation.restoration;
}

function failed(operation: ExclusiveOperation, error: unknown): Promise<void> {
    const ready = Promise.reject<void>(error);
    void ready.catch(report);
    void stopExclusive(operation).catch(report);
    return ready;
}

function attachRetainedSource(operation: ExclusiveOperation, witness: { isCurrent: () => boolean }): void {
    if (!current(operation) || !witness.isCurrent()) throw new Error('The measured audition changed before playback.');
    operation.playback = playAudioBufferPreview({
        buffer: operation.input.buffer,
        gain: operation.input.gain,
        intent: operation.intent ?? undefined,
        destination: audioEngine.audioPreviewOutput,
        onEnded: () => {
            void stopExclusive(operation).catch(report);
            operation.input.onEnded();
        },
    });
    if (operation.playback === null) throw new Error('The audition lost its source admission.');
}

function prepareSource(operation: ExclusiveOperation): Promise<void> {
    let resuming: Promise<void>;
    try {
        if (!current(operation)) throw new Error('The audition gesture was superseded.');
        // beginExclusive has already set programme gain0. Resume stays in the
        // actual activation, before any native await, including on suspension.
        resuming = audioEngine.context.resume();
    } catch (error) {
        return failed(operation, error);
    }
    const gated = reconcileNativeAuditionMonitoring({
        signal: operation.acquisition.signal,
        isCurrent: () => current(operation),
    });
    let cancelReady: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
        cancelReady = () => reject(new Error('The audition was stopped before listening readiness.'));
        operation.acquisition.signal.addEventListener('abort', cancelReady, { once: true });
    });
    const ready = Promise.race([Promise.all([resuming, gated]), cancelled])
        .then(([, witness]) => attachRetainedSource(operation, witness))
        .catch((error: unknown) => {
            void stopExclusive(operation).catch(report);
            throw error;
        })
        .finally(() => {
            if (cancelReady !== undefined) operation.acquisition.signal.removeEventListener('abort', cancelReady);
        });
    void ready.catch((error: unknown) => {
        if (!operation.acquisition.signal.aborted) report(error);
    });
    return ready;
}

/** Close both listening outputs before admitting one exact retained buffer. */
export function playExclusiveAudioBufferPreview(input: ExclusiveInput): {
    ready: Promise<void>;
    stop: () => Promise<void>;
} {
    if (!Number.isFinite(input.gain) || input.gain < 0 || input.gain > 1)
        throw new RangeError('A matched audition gain must be finite and between zero and one.');
    if (!audioEngine.isAudioAvailable() || !input.isCurrent() || unsafeOutputContexts.has(audioEngine.context))
        throw new Error('The retained audition is no longer available.');
    const operation: ExclusiveOperation = {
        input,
        owner: Symbol('retained-audition'),
        acquisition: new AbortController(),
        intent: null,
        playback: null,
        stopped: false,
        restoration: null,
        invalidate: () => {
            void stopExclusive(operation).catch(report);
        },
    };
    const stop = () => stopExclusive(operation);
    // Publish the successor before cancelling the old owner. An old abort or
    // ended callback can release only its own token, never this suppression.
    nativeLiveGraphSession.programmeCarrier ||= nativeLiveGraphSession.audibleCarrier;
    nativeLiveGraphSession.auditionOwner = operation.owner;
    nativeLiveGraphSession.auditionRestorationOwner = null;
    nativeLiveGraphSession.auditionInvalidation = operation.invalidate;
    try {
        operation.intent = audioEngine.beginExclusiveAudioPreviewIntent();
    } catch (error) {
        unsafeOutputContexts.add(audioEngine.context);
        return { ready: failed(operation, error), stop };
    }
    operation.intent.signal.addEventListener('abort', operation.invalidate, { once: true });
    if (operation.stopped) operation.intent.release();
    return { ready: prepareSource(operation), stop };
}
