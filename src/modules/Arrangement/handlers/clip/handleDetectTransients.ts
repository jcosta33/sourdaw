import {
    captureAutomergeStoragePreparationScope,
    captureAutomergeStorageTransactionScope,
} from '#/infra/store/storage/createAutomergeStorage';
import { detectTransientsForClip } from '#/modules/ElasticAudio/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';
import { canonicalJson, digest } from '#/utils/canonicalDigest';
import { createHandler } from '#/utils/createHandler';
import { type HandlerExecutionResult, type TrackClipStateSnapshot } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createWarpMarker } from '../../models/WarpMarker';
import { getWarpState, prepareTransientWarpState, setWarpState } from '../../stores/warpStates';
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
        // A first detection creates this satellite. Its inverse must name absence,
        // otherwise the restore's replacement-only noop check cannot see the new rows.
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
type TransientRows = ReturnType<typeof planTransientRows>;
type TransientPlan = ReturnType<typeof prepareTransientWarpState>;

function transientConflict(): HandlerExecutionResult {
    return { status: 'conflict', reason: 'Transient detection was cancelled or its source changed' };
}

function planTransientRows(clipId: string, result: DetectedSource) {
    const existing = getWarpState(clipId);
    const preserved = existing.markers.filter(
        (marker) => marker.locked === true || (marker.origin ?? 'user') !== 'transient-auto'
    );
    const added = result.hits.flatMap((hit) => {
        const beat = ((hit.sampleOffset / result.identity.sampleRate) * result.tempo) / 60;
        if (preserved.some((marker) => Math.abs(marker.originalBeat - beat) < 1e-3)) {
            return [];
        }
        return [createWarpMarker(beat, beat, { origin: 'transient-auto', confidence: hit.confidence })];
    });
    return {
        preserved,
        added,
        replacement: {
            ...existing,
            markers: [...preserved, ...added].sort((a, b) => a.originalBeat - b.originalBeat),
        },
    };
}

function materializationFailure(error: unknown, lifetime: DetectionLifetime): HandlerExecutionResult {
    if (!lifetime.isCurrent()) {
        return transientConflict();
    }
    throw error;
}

function createTransientWriteResult(
    result: DetectedSource,
    context: DetectContext,
    trackId: string,
    clipId: string,
    preserved: TransientRows['preserved'],
    added: TransientRows['added'],
    replacement: TransientRows['replacement'],
    commitStarted: number
): HandlerExecutionResult {
    let storageCommitStarted: number | undefined;
    const refusal = (): string | null =>
        result.isCurrent() && !context?.signal?.aborted ? null : 'Transient detection source changed before commit';
    const complete = (): void => {
        performance.measure('elastic-transient-commit', {
            start: commitStarted,
            end: performance.now(),
        });
        performance.clearMeasures('elastic-transient-commit');
        notifyUser(`Detected ${added.length} transients (${preserved.length} preserved)`, 'success');
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
                const tracks = record(document.tracks)?.tracks;
                let track: unknown;
                if (Array.isArray(tracks)) {
                    track = tracks.find((entry: unknown) => record(entry)?.id === trackId);
                }
                const clips = record(track)?.clips;
                let clip: unknown;
                if (Array.isArray(clips)) {
                    clip = clips.find((entry: unknown) => record(entry)?.id === clipId);
                }
                const bufferId = record(clip)?.audioBufferId;
                const states = record(record(document.warpStates)?.states);
                const validationStarted = performance.now();
                const reason =
                    refusal() ??
                    (record(document.projectMeta)?.projectId === result.identity.projectId &&
                    record(clip)?.type === 'audio' &&
                    typeof bufferId === 'string' &&
                    digest(bufferId) === result.identity.bufferId &&
                    record(document.transport)?.tempo === result.tempo &&
                    transientStateMatches(states?.[clipId], replacement)
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
        rows = planTransientRows(clipId, result);
    }
    if (!result.isCurrent() || context?.signal?.aborted) {
        return transientConflict();
    }
    const { preserved, added, replacement } = rows;
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
        capture.after.push(...captureTrackClipStates([trackId]));
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
    return createTransientWriteResult(result, context, trackId, clipId, preserved, added, replacement, commitStarted);
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
        const attempt = measurePreparationTask('elastic-transient-plan-task', () => {
            const rows = planTransientRows(clipId, result);
            return { rows, plan: prepareTransientWarpState(preparationScope, clipId, rows.replacement) };
        });
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
            }
            const requestMaterialization = plan?.requestMaterialization;
            if (plan && requestMaterialization) {
                const workerStarted = performance.now();
                try {
                    await requestMaterialization(lifetime.signal);
                } catch (error) {
                    return materializationFailure(error, lifetime);
                } finally {
                    performance.measure('elastic-transient-materialization-worker-wall', {
                        start: workerStarted,
                        end: performance.now(),
                    });
                    performance.clearMeasures('elastic-transient-materialization-worker-wall');
                }
                if (!(await lifetime.waitForFrame())) {
                    return transientConflict();
                }
                if (!plan.isCurrent()) {
                    continue;
                }
            }
            if (plan) {
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
