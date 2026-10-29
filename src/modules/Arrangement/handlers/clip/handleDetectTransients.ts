import { captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';
import { detectTransientsForClip } from '#/modules/ElasticAudio/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';
import { digest } from '#/utils/canonicalDigest';
import { createHandler } from '#/utils/createHandler';
import { type TrackClipStateSnapshot } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createWarpMarker } from '../../models/WarpMarker';
import { getWarpState, setWarpState } from '../../stores/warpStates';
import { captureTrackClipStates } from '../../useCases/captureTrackClipStates';

type Capture = { before: TrackClipStateSnapshot[]; after: TrackClipStateSnapshot[] };
const captures = new WeakMap<object, Capture>();

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

export const handleDetectTransients = createHandler<'detectTransients'>({
    execute: async (action, context) => {
        const scope = captureAutomergeStorageTransactionScope();
        const sensitivity =
            action.payload.sensitivity ??
            preferencesStore.value?.elasticTransientSensitivity ??
            defaultPreferences.elasticTransientSensitivity;
        const result = await detectTransientsForClip(action.payload.clipId, sensitivity, context?.signal);
        if (result.status === 'failed') {
            if (result.code === 'cancelled' || result.code === 'stale-source') {
                return { status: 'conflict', reason: 'Transient detection was cancelled or its source changed' };
            }
            notifyUser(`Transient detection failed: ${result.code}`, 'error');
            return { status: 'conflict', reason: `Transient detection failed: ${result.code}` };
        }
        if (!result.isCurrent() || context?.signal?.aborted || !result.identity.activeAlternative) {
            return { status: 'conflict', reason: 'Transient detection source changed' };
        }
        const capture = captures.get(action);
        if (!capture) {
            return { status: 'conflict', reason: 'Transient detection requires its registered command capture' };
        }
        const { clipId, trackId } = result.identity;
        const commitStarted = performance.now();
        const before = captureTrackClipStates([trackId]);
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
        const replacement = {
            ...existing,
            markers: [...preserved, ...added].sort((a, b) => a.originalBeat - b.originalBeat),
        };
        scope(() => {
            capture.before.push(...before);
            setWarpState(clipId, replacement);
            capture.after.push(...captureTrackClipStates([trackId]));
        });
        performance.measure('elastic-transient-preparation-task', { start: commitStarted, end: performance.now() });
        performance.clearMeasures('elastic-transient-preparation-task');
        let storageCommitStarted: number | undefined;
        const refusal = (): string | null =>
            result.isCurrent() && !context?.signal?.aborted ? null : 'Transient detection source changed before commit';
        const complete = (): void => {
            performance.measure('elastic-transient-commit', { start: commitStarted, end: performance.now() });
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
                    if (storageCommitStarted === undefined) return;
                    performance.measure('elastic-transient-storage-commit-task', {
                        start: storageCommitStarted,
                        end: performance.now(),
                    });
                    performance.clearMeasures('elastic-transient-storage-commit-task');
                },
                documentId: 'root',
                validateDocument: (document) => {
                    const tracks = record(document.tracks)?.tracks;
                    const track = Array.isArray(tracks)
                        ? tracks.find((entry: unknown) => record(entry)?.id === trackId)
                        : undefined;
                    const clips = record(track)?.clips;
                    const clip = Array.isArray(clips)
                        ? clips.find((entry: unknown) => record(entry)?.id === clipId)
                        : undefined;
                    const bufferId = record(clip)?.audioBufferId;
                    const states = record(record(document.warpStates)?.states);
                    return (
                        refusal() ??
                        (record(document.projectMeta)?.projectId === result.identity.projectId &&
                        record(clip)?.type === 'audio' &&
                        typeof bufferId === 'string' &&
                        digest(bufferId) === result.identity.bufferId &&
                        record(document.transport)?.tempo === result.tempo &&
                        digest(states?.[clipId]) === digest(replacement)
                            ? null
                            : 'Transient detection authority changed inside commit')
                    );
                },
                release: () => undefined,
            },
            afterCommit: complete,
            afterAmbiguousCommit: complete,
        };
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
