import { agentMeasurementArtifactStore } from '#/modules/AudioRendering/stores';
import { playExclusiveAudioBufferPreview } from '#/modules/AudioEngine/useCases';
import { subscribeToCrdtChanges } from '#/modules/CrdtDocument/useCases';

import {
    measuredPreviewAuditionRuntime,
    type MeasuredPreviewAuditionOperation,
} from '../services/measuredPreviewAuditionRuntime';
import { agentRunStore } from '../stores/agentRunStore';
import { measuredPreviewAuditionStore } from '../stores/measuredPreviewAuditionStore';
import { pendingActionConfirmationStore } from '../stores/pendingActionConfirmationStore';

import { resolveMeasuredPreviewAudition } from './resolveMeasuredPreviewAudition';
import { stopMeasuredPreviewAudition } from './stopMeasuredPreviewAudition';

type StartInput = Parameters<typeof resolveMeasuredPreviewAudition>[0] & { side: 'baseline' | 'preview' };
type ResolvedPair = Extract<ReturnType<typeof resolveMeasuredPreviewAudition>, { status: 'available' }>;

function prepareOperation(input: StartInput, pair: ResolvedPair) {
    const runtime = measuredPreviewAuditionRuntime;
    const previous = runtime.current;
    const operation: MeasuredPreviewAuditionOperation = {
        id: crypto.randomUUID(),
        confirmationId: input.confirmationId,
        targetId: input.targetId,
        side: input.side,
        identity: pair.identity,
        abort: new AbortController(),
        stopPlayback: null,
        releaseObservers: () => undefined,
        restoration: null,
    };
    runtime.operations.set(operation.id, operation);
    runtime.current = operation;
    measuredPreviewAuditionStore.set({
        confirmationId: input.confirmationId,
        operationId: operation.id,
        targetId: input.targetId,
        side: input.side,
        phase: 'acquiring',
        error: null,
    });
    const isCurrent = () => {
        if (operation.abort.signal.aborted || runtime.current !== operation) {
            return false;
        }
        const current = resolveMeasuredPreviewAudition(input);
        return current.status === 'available' && current.identity === operation.identity;
    };
    const stop = () => stopMeasuredPreviewAudition({ operationId: operation.id });
    const revalidate = () => {
        if (!operation.abort.signal.aborted && !isCurrent()) {
            void stop();
        }
    };
    const subscriptions = [
        agentMeasurementArtifactStore.subscribe(revalidate),
        pendingActionConfirmationStore.subscribe(revalidate),
        agentRunStore.subscribe(revalidate),
        subscribeToCrdtChanges(revalidate),
    ];
    operation.releaseObservers = () => {
        for (const unsubscribe of subscriptions.splice(0)) {
            unsubscribe();
        }
    };
    return { runtime, previous, operation, isCurrent, stop };
}

type PreparedOperation = ReturnType<typeof prepareOperation>;

function acquirePlayback(input: StartInput, pair: ResolvedPair, prepared: PreparedOperation) {
    const { operation, previous, isCurrent, stop } = prepared;
    // This call gates synchronously and resumes in this exact gesture.
    // It publishes the new output owner before aborting its predecessor.
    const installed = Promise.withResolvers<() => Promise<void>>();
    // A canonical-store callback may retire this operation while the
    // executor is synchronously acquiring its handle. Its Stop must wait
    // for that real handle, rather than publish an early idle settlement.
    operation.stopPlayback = () => installed.promise.then((stopPlayback) => stopPlayback());
    let playback: ReturnType<typeof playExclusiveAudioBufferPreview> | null = null;
    try {
        playback = playExclusiveAudioBufferPreview({
            buffer: pair[input.side].buffer,
            gain: pair[input.side].gain,
            isCurrent,
            onEnded: () => {
                void stop();
            },
        });
        operation.stopPlayback = playback.stop;
    } finally {
        installed.resolve(playback?.stop ?? (() => Promise.resolve()));
        if (previous !== null) {
            void stopMeasuredPreviewAudition({ operationId: previous.id });
        }
    }
    if (playback === null) throw new Error('The audition source handle was not acquired.');
    return playback;
}

/** Start from the genuine retained pair; listening never writes proof or approval. */
export async function startMeasuredPreviewAudition(
    input: StartInput
): Promise<{ status: 'playing' | 'superseded' } | { status: 'unavailable'; reason: string }> {
    const pair = resolveMeasuredPreviewAudition(input);
    if (pair.status === 'unavailable') return pair;
    const prepared = prepareOperation(input, pair);
    const { runtime, operation, isCurrent, stop } = prepared;
    try {
        if (!isCurrent()) {
            await stop();
            return { status: 'superseded' };
        }
        const playback = acquirePlayback(input, pair, prepared);
        if (!isCurrent()) {
            await stop();
            return { status: 'superseded' };
        }
        await playback.ready;
        if (!isCurrent()) {
            await stop();
            return { status: 'superseded' };
        }
        measuredPreviewAuditionStore.set({
            confirmationId: input.confirmationId,
            operationId: operation.id,
            targetId: input.targetId,
            side: input.side,
            phase: 'playing',
            error: null,
        });
        return { status: 'playing' };
    } catch (error) {
        const superseded = operation.abort.signal.aborted || runtime.current !== operation;
        await stop();
        if (superseded) {
            return { status: 'superseded' };
        }
        const reason = error instanceof Error ? error.message : 'The retained audition could not start.';
        if (
            runtime.current === null &&
            measuredPreviewAuditionStore.value?.confirmationId === operation.confirmationId
        ) {
            measuredPreviewAuditionStore.update((state) => (state ? { ...state, error: reason } : state));
        }
        return { status: 'unavailable', reason };
    }
}
