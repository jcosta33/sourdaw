import {
    captureAutomergeStoragePreparationScope,
    captureAutomergeStorageTransactionScope,
} from '#/infra/store/storage/createAutomergeStorage';
import { getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { detectTransientsForClip } from '#/modules/ElasticAudio/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';
import { readTempoAtBeat, sanitize_tempo_map_state, sanitize_transport_snapshot } from '#/modules/Transport/stores';
import { canonicalJson, digest } from '#/utils/canonicalDigest';
import { createHandler } from '#/utils/createHandler';
import { type HandlerExecutionResult } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type TrackClipStateSnapshot } from '../../events/arrangementTrackSnapshots';
import { createWarpMarker } from '../../models/WarpMarker';
import { getWarpState, isDefaultWarpState, prepareTransientWarpState, setWarpState } from '../../stores/warpStates';
import { captureTrackClipStates } from '../../useCases/captureTrackClipStates';

type Capture = { before: TrackClipStateSnapshot[]; after: TrackClipStateSnapshot[] };
const captures = new WeakMap<object, Capture>();

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

/** Full canonical equality without serializing every scalar on the common dense JSON path. */
export function transientStateMatches(actual: unknown, expected: unknown): boolean {
    if (actual === expected) {
        return true;
    }
    if (Array.isArray(actual) || Array.isArray(expected)) {
        if (!Array.isArray(actual) || !Array.isArray(expected)) {
            return false;
        }
        if (actual.length !== expected.length) {
            return canonicalJson(actual) === canonicalJson(expected);
        }
        for (let index = 0; index < actual.length; index++) {
            // Canonical serialization distinguishes holes from explicit undefined.
            if (actual[index] === undefined || expected[index] === undefined) {
                return canonicalJson(actual) === canonicalJson(expected);
            }
            if (!transientStateMatches(actual[index], expected[index])) {
                return false;
            }
        }
        return true;
    }
    const actualRecord = record(actual);
    const expectedRecord = record(expected);
    if (actualRecord && expectedRecord) {
        const keys = Object.keys(actualRecord);
        if (keys.length !== Object.keys(expectedRecord).length) {
            return false;
        }
        for (const key of keys) {
            if (!Object.hasOwn(expectedRecord, key) || !transientStateMatches(actualRecord[key], expectedRecord[key])) {
                return false;
            }
        }
        return true;
    }
    return canonicalJson(actual) === canonicalJson(expected);
}

function captureTransientClipStates(trackId: string, clipId: string): TrackClipStateSnapshot[] {
    return captureTrackClipStates([trackId]).map((entry) => {
        let clipSatellites = entry.clipSatellites;
        // Detection can create or remove this satellite. Name absence in both
        // snapshots so the restore's replacement-only noop check sees the transition.
        if (!clipSatellites.some((satellite) => satellite.clipId === clipId)) {
            clipSatellites = [...clipSatellites, { clipId, gainEnvelope: null, warpState: null }];
        }
        return { ...entry, clipSatellites };
    });
}

function measurePreparationTask<Result>(name: string, callback: () => Result): Result {
    const start = performance.now();
    try {
        return callback();
    } finally {
        performance.measure(name, { start, end: performance.now() });
        performance.clearMeasures(name);
    }
}

type DetectExecution = Parameters<typeof createHandler<'detectTransients'>>[0]['execute'];
type DetectAction = Parameters<DetectExecution>[0];
type DetectContext = Parameters<DetectExecution>[1];
type DetectConsumer = Parameters<typeof detectTransientsForClip>[3];
type DetectedSource = Parameters<DetectConsumer>[0];
type DetectionLifetime = Parameters<DetectConsumer>[1];
type StorageScope = ReturnType<typeof captureAutomergeStorageTransactionScope>;
type PreparationScope = ReturnType<typeof captureAutomergeStoragePreparationScope>;
type TransientRows = NonNullable<ReturnType<typeof planDetectRows>>;
type TransientPlan = ReturnType<typeof prepareTransientWarpState>;
type MaterializationOutcome = 'ready' | 'stale' | 'cancelled';

function transientConflict(): HandlerExecutionResult {
    return { status: 'conflict', reason: 'Transient detection was cancelled or its source changed' };
}

function findDocumentClip(document: Record<string, unknown>, trackId: string, clipId: string): unknown {
    const tracks = record(document.tracks)?.tracks;
    if (!Array.isArray(tracks)) {
        return undefined;
    }
    const clips = record(tracks.find((entry: unknown) => record(entry)?.id === trackId))?.clips;
    return Array.isArray(clips) ? clips.find((entry: unknown) => record(entry)?.id === clipId) : undefined;
}

function findDocumentClipStartBeat(
    document: Record<string, unknown>,
    trackId: string,
    clipId: string
): number | undefined {
    const startBeat = record(findDocumentClip(document, trackId, clipId))?.startBeat;
    return typeof startBeat === 'number' ? startBeat : undefined;
}

/**
 * The tempo playback reads at the clip's start: the tempo-map and transport
 * stores, which sanitize the document slots. Undefined when the clip cannot be
 * found: no fallback tempo is invented.
 */
function readPlaybackClipStartTempo(trackId: string, clipId: string): number | undefined {
    const document = getCrdtDoc<Record<string, unknown>>('root');
    const beat = document ? findDocumentClipStartBeat(document, trackId, clipId) : undefined;
    return beat === undefined ? undefined : readTempoAtBeat({ beat });
}

/** The same tempo, derived from a raw document through the stores' own sanitizers. */
function readDocumentClipStartTempo(
    document: Record<string, unknown>,
    trackId: string,
    clipId: string
): number | undefined {
    const beat = findDocumentClipStartBeat(document, trackId, clipId);
    if (beat === undefined) {
        return undefined;
    }
    const clock = {
        tempo: sanitize_transport_snapshot(document.transport).tempo,
        changes: sanitize_tempo_map_state(document.tempoMap).changes,
    };
    return readTempoAtBeat({ beat, clock });
}

/**
 * A markerless result identical to the stored state (an absent one reads as the
 * default) has nothing to record, as on main when marker removal deleted the
 * state. A marked state still takes the ordinary write route.
 */
function replacementIsStored(clipId: string, replacement: TransientRows['replacement']): boolean {
    return replacement.markers.length === 0 && transientStateMatches(getWarpState(clipId), replacement);
}

function planTransientRows(
    result: DetectedSource,
    existing: ReturnType<typeof getWarpState>,
    referenceTempo: number,
    clipStartTempo: number | null
) {
    const preserved = existing.markers.filter(
        (marker) => marker.locked === true || (marker.origin ?? 'user') !== 'transient-auto'
    );
    const added = result.hits.flatMap((hit) => {
        const beat = ((hit.sampleOffset / result.identity.sampleRate) * referenceTempo) / 60;
        if (preserved.some((marker) => Math.abs(marker.originalBeat - beat) < 1e-3)) {
            return [];
        }
        return [createWarpMarker(beat, beat, { origin: 'transient-auto', confidence: hit.confidence })];
    });
    const markers = [...preserved, ...added].sort((a, b) => a.originalBeat - b.originalBeat);
    // A markerless result has no beats to anchor, so it stamps no tempo: the stored
    // one stays, and a clip with none stays a default state.
    const originalTempo = markers.length > 0 ? referenceTempo : existing.originalTempo;
    return { preserved, added, clipStartTempo, replacement: { ...existing, originalTempo, markers } };
}

/**
 * A marker's originalBeat counts source beats at the reference tempo, so it stays
 * the source position when the project tempo changes later. A stored tempo is
 * kept and the clip-start tempo is not read; a first stamp takes the tempo
 * playback reads at the clip's start. Undefined when that tempo cannot be read.
 */
function planDetectRows(trackId: string, clipId: string, result: DetectedSource) {
    const existing = getWarpState(clipId);
    if (typeof existing.originalTempo === 'number') {
        return planTransientRows(result, existing, existing.originalTempo, null);
    }
    const clipStartTempo = readPlaybackClipStartTempo(trackId, clipId);
    if (clipStartTempo === undefined) {
        return undefined;
    }
    return planTransientRows(result, existing, clipStartTempo, clipStartTempo);
}

/** Keep committed history rendering ahead of success feedback without waiting for a visible frame. */
function waitForTransientCompletionTask(): Promise<void> {
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        let settled = false;
        const finish = (error?: Error): void => {
            if (settled) {
                return;
            }
            settled = true;
            channel.port1.onmessage = null;
            channel.port1.onmessageerror = null;
            channel.port1.close();
            channel.port2.close();
            window.removeEventListener('pagehide', pageHidden);
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        };
        const pageHidden = (): void => finish();
        channel.port1.onmessage = () => {
            if (settled) {
                return;
            }
            performance.mark('elastic-transient-completion-task-delivered');
            performance.clearMarks('elastic-transient-completion-task-delivered');
            finish();
        };
        channel.port1.onmessageerror = () => finish(new Error('Transient completion task could not be delivered'));
        window.addEventListener('pagehide', pageHidden, { once: true });
        try {
            performance.mark('elastic-transient-completion-task-enqueued');
            performance.clearMarks('elastic-transient-completion-task-enqueued');
            channel.port2.postMessage(undefined);
        } catch (error) {
            if (error instanceof Error) {
                finish(error);
                return;
            }
            finish(new Error('Transient completion task could not be scheduled', { cause: error }));
        }
    });
}

function createTransientWriteResult(
    result: DetectedSource,
    context: DetectContext,
    trackId: string,
    clipId: string,
    preserved: TransientRows['preserved'],
    added: TransientRows['added'],
    replacement: TransientRows['replacement'],
    clipStartTempo: number | null,
    commitStarted: number
): HandlerExecutionResult {
    let storageCommitStarted: number | undefined;
    const expectedState = isDefaultWarpState(replacement) ? undefined : replacement;
    const refusal = (): string | null =>
        result.isCurrent() && !context?.signal?.aborted ? null : 'Transient detection source changed before commit';
    let completion: Promise<void> | undefined;
    const complete = (): Promise<void> => {
        completion ??= (async () => {
            performance.measure('elastic-transient-commit', {
                start: commitStarted,
                end: performance.now(),
            });
            performance.clearMeasures('elastic-transient-commit');
            await waitForTransientCompletionTask();
            performance.mark('elastic-transient-success-notification');
            performance.clearMarks('elastic-transient-success-notification');
            notifyUser(`Detected ${added.length} transients (${preserved.length} preserved)`, 'success');
        })().catch((error: unknown) => {
            completion = undefined;
            throw error;
        });
        // Reconciliation shares successful feedback and retries only a failed attempt.
        return completion;
    };
    return {
        status: 'written',
        commitValidation: {
            beforeCommit: () => {
                storageCommitStarted ??= performance.now();
                return refusal();
            },
            afterPublication: () => {
                if (storageCommitStarted === undefined) {
                    return;
                }
                performance.measure('elastic-transient-storage-commit-task', {
                    start: storageCommitStarted,
                    end: performance.now(),
                });
                performance.clearMeasures('elastic-transient-storage-commit-task');
            },
            documentId: 'root',
            validateDocument: (document) => {
                const clip = findDocumentClip(document, trackId, clipId);
                const bufferId = record(clip)?.audioBufferId;
                const states = record(record(document.warpStates)?.states);
                const validationStarted = performance.now();
                const reason =
                    refusal() ??
                    (record(document.projectMeta)?.projectId === result.identity.projectId &&
                    record(clip)?.type === 'audio' &&
                    typeof bufferId === 'string' &&
                    digest(bufferId) === result.identity.bufferId &&
                    (clipStartTempo === null ||
                        readDocumentClipStartTempo(document, trackId, clipId) === clipStartTempo) &&
                    transientStateMatches(states?.[clipId], expectedState)
                        ? null
                        : 'Transient detection authority changed inside commit');
                performance.measure('elastic-transient-validation-task', {
                    start: validationStarted,
                    end: performance.now(),
                });
                performance.clearMeasures('elastic-transient-validation-task');
                return reason;
            },
            release: () => undefined,
        },
        afterCommit: complete,
        afterAmbiguousCommit: complete,
    };
}

function completeUnchangedDetection(
    result: DetectedSource,
    context: DetectContext,
    rows: TransientRows,
    commitStarted: number
): HandlerExecutionResult {
    const { trackId, clipId } = result.identity;
    const validation = createTransientWriteResult(
        result,
        context,
        trackId,
        clipId,
        rows.preserved,
        rows.added,
        rows.replacement,
        rows.clipStartTempo,
        commitStarted
    ).commitValidation;
    const document = getCrdtDoc<Record<string, unknown>>('root');
    if (!validation || !document) {
        return transientConflict();
    }
    if (validation.validateDocument(document) !== null || !result.completeUnchanged()) {
        return transientConflict();
    }
    notifyUser('Detected 0 transients (0 preserved)', 'success');
    return { status: 'no-write' };
}

function commitTransientRows(
    result: DetectedSource,
    context: DetectContext,
    scope: StorageScope,
    capture: Capture,
    plannedRows: TransientRows,
    plan: TransientPlan,
    clipId: string,
    trackId: string
): HandlerExecutionResult | undefined {
    const commitStarted = performance.now();
    let rows = plannedRows;
    if (!plan) {
        // Ineligible ordinary writes are still planned from the latest rows at their final frame.
        const replanned = planDetectRows(trackId, clipId, result);
        if (!replanned) {
            return transientConflict();
        }
        rows = replanned;
    }
    if (!result.isCurrent() || context?.signal?.aborted) {
        return transientConflict();
    }
    const { preserved, added, replacement } = rows;
    if (replacementIsStored(clipId, replacement)) {
        return completeUnchangedDetection(result, context, rows, commitStarted);
    }
    const before = captureTransientClipStates(trackId, clipId);
    const staged = scope(() => {
        if (plan) {
            if (!plan.stage()) {
                return false;
            }
        } else {
            setWarpState(clipId, replacement);
        }
        capture.before.push(...before);
        capture.after.push(...captureTransientClipStates(trackId, clipId));
        return true;
    });
    if (!staged) {
        return undefined;
    }
    performance.measure('elastic-transient-preparation-task', {
        start: commitStarted,
        end: performance.now(),
    });
    performance.clearMeasures('elastic-transient-preparation-task');
    return createTransientWriteResult(
        result,
        context,
        trackId,
        clipId,
        preserved,
        added,
        replacement,
        rows.clipStartTempo,
        commitStarted
    );
}

function readTransientCapture(action: DetectAction, result: DetectedSource): Capture | HandlerExecutionResult {
    if (!result.identity.activeAlternative) {
        return transientConflict();
    }
    const capture = captures.get(action);
    if (!capture) {
        return { status: 'conflict', reason: 'Transient detection requires its registered command capture' };
    }
    return capture;
}

async function waitForTransientMaterialization(
    request: (signal: AbortSignal) => Promise<void>,
    plan: NonNullable<TransientPlan>,
    lifetime: DetectionLifetime
): Promise<MaterializationOutcome> {
    const workerStarted = performance.now();
    try {
        await request(lifetime.signal);
    } catch (error) {
        if (!lifetime.isCurrent()) {
            return 'cancelled';
        }
        if (!plan.isCurrent()) {
            return 'stale';
        }
        throw error;
    } finally {
        performance.measure('elastic-transient-materialization-worker-wall', {
            start: workerStarted,
            end: performance.now(),
        });
        performance.clearMeasures('elastic-transient-materialization-worker-wall');
    }
    return (await lifetime.waitForFrame()) ? 'ready' : 'cancelled';
}

/**
 * One planning attempt: the rows at the tempo playback reads at the clip start
 * and, unless the replacement is already stored, its private preparation.
 * Undefined when the clip-start tempo cannot be read.
 */
function planDetectAttempt(
    preparationScope: PreparationScope,
    result: DetectedSource,
    trackId: string,
    clipId: string
): { rows: TransientRows; plan: TransientPlan } | undefined {
    return measurePreparationTask('elastic-transient-plan-task', () => {
        const rows = planDetectRows(trackId, clipId, result);
        if (!rows) {
            return undefined;
        }
        // An identical replacement needs no private preparation: it completes without a write.
        if (replacementIsStored(clipId, rows.replacement)) {
            return { rows, plan: undefined };
        }
        return { rows, plan: prepareTransientWarpState(preparationScope, clipId, rows.replacement) };
    });
}

async function consumeDetectedTransients(
    action: DetectAction,
    context: DetectContext,
    scope: StorageScope,
    preparationScope: PreparationScope,
    result: DetectedSource,
    lifetime: DetectionLifetime
): Promise<HandlerExecutionResult> {
    const capture = readTransientCapture(action, result);
    if ('status' in capture) {
        return capture;
    }
    const { clipId, trackId } = result.identity;
    while (lifetime.isCurrent()) {
        const attempt = planDetectAttempt(preparationScope, result, trackId, clipId);
        if (!attempt) {
            return transientConflict();
        }
        const rows = attempt.rows;
        const plan = attempt.plan;
        try {
            if (plan) {
                if (!(await lifetime.waitForFrame())) {
                    return transientConflict();
                }
                if (!plan.isCurrent()) {
                    continue;
                }
                measurePreparationTask('elastic-transient-clone-task', plan.clone);
                if (!(await lifetime.waitForFrame())) {
                    return transientConflict();
                }
                if (!plan.isCurrent()) {
                    continue;
                }
                const request = plan.requestMaterialization;
                let materialization: MaterializationOutcome = 'ready';
                if (request) {
                    materialization = await waitForTransientMaterialization(request, plan, lifetime);
                }
                if (materialization === 'cancelled' || !lifetime.isCurrent()) {
                    return transientConflict();
                }
                if (materialization === 'stale' || !plan.isCurrent()) {
                    continue;
                }
                measurePreparationTask('elastic-transient-change-task', plan.materialize);
            }
            if (!(await lifetime.waitForFrame())) {
                return transientConflict();
            }
            if (plan && !plan.isCurrent()) {
                continue;
            }
            const committed = commitTransientRows(result, context, scope, capture, rows, plan, clipId, trackId);
            if (committed === undefined) {
                continue;
            }
            return committed;
        } finally {
            plan?.discard();
        }
    }
    return transientConflict();
}

export const handleDetectTransients = createHandler<'detectTransients'>({
    execute: async (action, context) => {
        const scope = captureAutomergeStorageTransactionScope();
        const preparationScope = captureAutomergeStoragePreparationScope();
        const sensitivity =
            action.payload.sensitivity ??
            preferencesStore.value?.elasticTransientSensitivity ??
            defaultPreferences.elasticTransientSensitivity;
        const outcome = await detectTransientsForClip(
            action.payload.clipId,
            sensitivity,
            context?.signal,
            (result, lifetime) => consumeDetectedTransients(action, context, scope, preparationScope, result, lifetime)
        );
        if (outcome.status === 'consumed') {
            return outcome.value;
        }
        if (outcome.code === 'cancelled' || outcome.code === 'stale-source') {
            return { status: 'conflict', reason: 'Transient detection was cancelled or its source changed' };
        }
        notifyUser(`Transient detection failed: ${outcome.code}`, 'error');
        return { status: 'conflict', reason: `Transient detection failed: ${outcome.code}` };
    },
    describe: (action) => {
        const capture: Capture = { before: [], after: [] };
        captures.set(action, capture);
        return {
            label: 'Detect transients',
            inverseAction: {
                type: 'restoreTrackClipStates',
                payload: { expected: capture.after, replacement: capture.before },
            },
            redoAction: {
                type: 'restoreTrackClipStates',
                payload: { expected: capture.before, replacement: capture.after },
            },
        };
    },
    previewExecution: 'unsupported-external',
    requiresAbortCompensation: false,
    undoable: true,
});
