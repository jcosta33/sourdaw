import { logger } from '#/infra/logger/appLogger';
import { captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';
import { engineRtDiagnosticsStore } from '#/modules/AudioEngine/stores';
import {
    cacheAudioBuffer,
    engineSampleRateOf,
    getCompensationDelay,
    getDeviceChainTailSeconds,
} from '#/modules/AudioEngine/useCases';
import { executeAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    captureProjectRootIdentity,
    projectRevisionMatchesLiveIgnoringSaveWrites,
} from '#/modules/CrdtDocument/useCases';
import { defaultExternalPluginTailState, externalPluginTailStore } from '#/modules/PluginHost/stores';
import { refreshExternalPluginTails } from '#/modules/PluginHost/useCases';
import { projectStore } from '#/modules/Project/stores';
import { FREEZE_BAKE_VERSION } from '#/utils/frozenBufferTail';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { valuesEqual } from '#/utils/structuralEquality';

import { type FreezeStateSnapshot } from '../../events/arrangementTrackSnapshots';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { trackStore } from '../../stores/trackStore';
import { getPluginById } from '../getPluginById';

import { assertFreezeSourceUnchangedUnlessRecording } from './assertFreezeSourceUnchangedUnlessRecording';
import { captureFreezeRender, type FreezeRender } from './captureFreezeRender';
import { detectSilentBake } from './detectSilentBake';
import { freezeCompensationOmitTypes } from './freezeCompensationOmitTypes';
import { freezeCompensationPinSeconds } from './freezeCompensationPinSeconds';
import { captureFreezeStateSnapshot } from './freezeStateSnapshot';
import { freezeStateSnapshotMatches } from './freezeStateSnapshotMatches';
import { getFreezeRenderSpan } from './getFreezeRenderSpan';
import { refuseFreezeCommit } from './refuseFreezeCommit';
import { rememberSettledFreezeState } from './rememberSettledFreezeState';
import { renderTrackOffline, type RenderScheduleTally } from './renderOffline';
import { restoreCancelledFreeze } from './restoreCancelledFreeze';
import { settledBeforeFreeze } from './settledBeforeFreeze';

export const activeFreezeTasks = new Map<string, AbortController>();

type FreezeTaskIdentity = {
    abortController: AbortController;
    projectId: number;
    rootIdentity: string;
    trackId: string;
    /** The freezing state this task wrote; null when the track vanished before it could be read. */
    pendingFreeze: FreezeStateSnapshot | null;
};

function isEligibleActiveProjectTrack({
    projectId,
    rootIdentity,
    trackId,
}: Pick<FreezeTaskIdentity, 'projectId' | 'rootIdentity' | 'trackId'>): boolean {
    const activeProject = projectStore.value;
    const activeState = trackStore.value;
    if (
        !activeProject ||
        activeProject.createdAt !== projectId ||
        captureProjectRootIdentity() !== rootIdentity ||
        !activeState
    ) {
        return false;
    }
    const activeTrack = activeState.tracks.find((candidate) => candidate.id === trackId);
    return (
        activeTrack !== undefined &&
        activeTrack.freezeState.status !== 'frozen' &&
        getTrackEligibility(activeTrack.kind).acceptsFreeze
    );
}

function isRegisteredFreezeTask(task: FreezeTaskIdentity): boolean {
    return activeFreezeTasks.get(task.trackId) === task.abortController && isEligibleActiveProjectTrack(task);
}

/**
 * Gates every write that lands after an await. A synced write from a collaborator runs no local
 * action, so it never cancels this task: the live track must still show the freezing state this task
 * wrote, and any departure, local or remote, stops the write. The source-edit refusal and the failure
 * path use `isRegisteredFreezeTask` instead, so a local edit that reset the track still reports why.
 */
function isCurrentFreezeTask(task: FreezeTaskIdentity): boolean {
    if (!isRegisteredFreezeTask(task) || !task.pendingFreeze) {
        return false;
    }
    const liveTrack = trackStore.value?.tracks.find((candidate) => candidate.id === task.trackId);
    return liveTrack !== undefined && freezeStateSnapshotMatches(liveTrack, task.pendingFreeze);
}

/**
 * Whether the finished render must not commit. The recording refusal runs first because it reports
 * why a recording start reset the track; any other departure from the freezing state, a
 * collaborator's unfreeze included, ends the task silently.
 */
function refuseLateFreezeCommit(task: FreezeTaskIdentity): boolean {
    return refuseFreezeCommit(task.trackId, () => isRegisteredFreezeTask(task)) || !isCurrentFreezeTask(task);
}

function clearFreezeTaskIfCurrent(trackId: string, abortController: AbortController): void {
    if (activeFreezeTasks.get(trackId) === abortController) {
        activeFreezeTasks.delete(trackId);
        settledBeforeFreeze.delete(trackId);
    }
}

/**
 * How far past the content a take has to ring. This used to be a substring
 * test on the device type that no descriptor fed, so it could not see the Dutch
 * Oven or Bacteria and shrank with tempo because beats are not seconds.
 *
 * A hosted plugin's tail moves with its preset, and a VST3 plugin never says
 * so, so ask each loaded instance now, as an export does, and size from what it
 * answers. Null when the freeze was cancelled or superseded during the refresh.
 */
async function readFreezeTailSeconds(freezeRender: FreezeRender, task: FreezeTaskIdentity): Promise<number | null> {
    await refreshExternalPluginTails();
    if (!isRegisteredFreezeTask(task)) {
        return null;
    }
    const { target, source } = freezeRender;
    return getDeviceChainTailSeconds({
        devices: target.devices,
        automationLanes: source.project.automationLanes.filter((lane) => lane.trackId === target.id),
        tailForDeviceType: (deviceType) => getPluginById(deviceType)?.tail,
        hostedTailSamplesByInstanceId: (externalPluginTailStore.value ?? defaultExternalPluginTailState)
            .tailSamplesByInstanceId,
        engineSampleRate: engineSampleRateOf(engineRtDiagnosticsStore.value),
    }).seconds;
}

function captureLiveFreezeState(trackId: string): ReturnType<typeof captureFreezeStateSnapshot> | null {
    const liveTrack = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    return liveTrack ? captureFreezeStateSnapshot(liveTrack) : null;
}

export async function freezeTrack(trackId: string, freezeIdOverride?: string): Promise<boolean> {
    const state = trackStore.value;
    const project = projectStore.value;
    if (!state || !project) {
        return false;
    }

    // Every write below the first `await` lands after the action's storage transaction
    // has stopped being ambient, so without this they commit on their own frame — a
    // rolled-back freeze still left the track pointing at the rendered take, and the
    // final freeze state could land separately from the undo stack advancing. Captured
    // here, while the transaction is still ambient; `await` outside, write inside.
    const scope = captureAutomergeStorageTransactionScope();

    const track = state.tracks.find((time) => time.id === trackId);
    if (!track || track.freezeState.status === 'frozen') {
        return false;
    }
    if (!getTrackEligibility(track.kind).acceptsFreeze) {
        return false;
    }
    const previousFreeze = rememberSettledFreezeState(track);

    if (activeFreezeTasks.has(trackId)) {
        activeFreezeTasks.get(trackId)!.abort();
    }
    const abortController = new AbortController();
    activeFreezeTasks.set(trackId, abortController);
    const projectId = project.createdAt;
    const rootIdentity = captureProjectRootIdentity();
    const sourceRevision = captureProjectRevision();

    updateTrack(trackId, (time) => ({
        ...time,
        freezeState: { ...time.freezeState, status: 'freezing', renderProgress: 0 },
    }));
    const pendingFreeze = captureLiveFreezeState(trackId);
    const taskIdentity: FreezeTaskIdentity = { abortController, projectId, rootIdentity, trackId, pendingFreeze };

    try {
        // One synchronous read of everything the render reads, signed as it is read. The render
        // consumes this capture, never the live stores, so no edit can reach the take after it.
        const freezeRender = captureFreezeRender(trackId);
        // How far past the content this take has to ring; see `readFreezeTailSeconds`. Its refresh
        // awaits the host, so it runs after the capture: the tail is sized from the captured devices
        // and lanes, and an edit landing during the refresh is refused by the commit's signature check.
        const tailSeconds = await readFreezeTailSeconds(freezeRender, taskIdentity);
        if (tailSeconds === null) {
            return false;
        }

        const { startBeat, endBeat } = getFreezeRenderSpan(track.clips);

        let scheduleTally: RenderScheduleTally = { scheduledNotes: 0, scheduledBuffers: [], withheldDeviceTypes: [] };
        const renderedBuffer = await renderTrackOffline(freezeRender.target, startBeat, endBeat, {
            tailSeconds,
            captured: freezeRender,
            onScheduled: (tally) => {
                scheduleTally = tally;
            },
            // The buffer is replayed through this track's own fader and panner —
            // live attaches it to `preFaderTap`, the mixdown to the fader node —
            // so those two values must stay out of the print or they are applied
            // twice.
            targetMixer: 'keepLive',
            abortSignal: abortController.signal,
            onProgress: (param) => {
                if (!isCurrentFreezeTask(taskIdentity)) {
                    return;
                }
                scope(() => {
                    updateTrack(trackId, (time) => ({
                        ...time,
                        freezeState: { ...time.freezeState, renderProgress: param },
                    }));
                });
            },
        });

        if (!isRegisteredFreezeTask(taskIdentity)) {
            return false;
        }

        if (!renderedBuffer) {
            throw new Error('Render failed');
        }

        // Refuse the bake, not just the later flatten. A frozen buffer replaces
        // the track's live sound, so committing silence here already silences
        // the session; and once it is cached and pinned to `freezeState`, every
        // downstream path — flatten, the mixdown that replays frozen buffers,
        // the staleness check that sees no content change — treats it as the
        // track's true sound. Failing at the render keeps the silent buffer out
        // of the project entirely, and freeze is the one operation here the
        // user can simply run again.
        const silentBake = detectSilentBake({
            track,
            buffer: renderedBuffer,
            tally: scheduleTally,
            // `targetMixer: 'keepLive'` prints the target at unity, so the
            // track's own fader is not part of this render and cannot excuse a
            // silent result.
            bakedFaderGain: 1,
            // Mixer lanes are withheld from the target on this path, but device
            // lanes are baked and any of them can resolve to a gain of zero.
            bakesAutomation: true,
            operation: 'Freeze',
        });
        if (silentBake.silentBake) {
            throw new Error(silentBake.message);
        }

        // Synchronous from here to the commit write: no await can let a note or a recording start land in between.
        assertFreezeSourceUnchangedUnlessRecording(trackId, freezeRender.signature, () =>
            isRegisteredFreezeTask(taskIdentity)
        );
        if (refuseLateFreezeCommit(taskIdentity)) {
            return false;
        }

        const renderedAt = Date.now();
        // Resolved by the command layer when this runs as an action, so the handler's
        // `describe()` can guard its inverse on the exact take this run produces.
        const freezeId = freezeIdOverride ?? `freeze-${trackId}-${String(renderedAt)}`;
        cacheAudioBuffer({ buffer: renderedBuffer, bufferId: freezeId, freezeProjectId: project.createdAt });

        // FX-4 residual — pin only latency the offline print did not bake.
        // `scheduleTrackClips` already shifts clips by live PDC; pinning the full
        // omit-list figure would double-apply that delay on frozen playback.
        // Pin omittedDelay − liveDelay (clamped at 0): plugin/bridge residual
        // when another track owns session max, or the full omitted figure when
        // this track is session max (live = 0).
        // Both figures read the device latencies the render aligned its strips by, not the live ones.
        const liveDelay = getCompensationDelay(trackId, undefined, undefined, scheduleTally.compensationInput);
        const omittedDelay = getCompensationDelay(
            trackId,
            freezeCompensationOmitTypes(track.devices, scheduleTally.withheldDeviceTypes),
            undefined,
            scheduleTally.compensationInput
        );
        const compensationSeconds = freezeCompensationPinSeconds(liveDelay, omittedDelay);

        scope(() => {
            updateTrack(trackId, (time) => ({
                ...time,
                frozen: true,
                frozenBufferId: freezeId,
                freezeState: {
                    status: 'frozen',
                    freezeId,
                    frozenBufferId: freezeId,
                    sourceContentHash: freezeRender.signature,
                    compensationSeconds,
                    renderSettings: {
                        sampleRate: renderedBuffer.sampleRate,
                        bitDepth: 32,
                        channelCount: renderedBuffer.numberOfChannels,
                        // Recorded as the seconds actually rendered, not re-derived
                        // from a beat count and the tempo. The buffer's decay is a
                        // duration; converting it through tempo twice was what let
                        // the recorded number describe a different length than the
                        // one on disk.
                        tailLengthSeconds: tailSeconds,
                        bakeVersion: FREEZE_BAKE_VERSION,
                    },
                    renderedAt,
                },
            }));
        });
    } catch (error) {
        const currentTask = activeFreezeTasks.get(trackId);
        if (
            (currentTask !== undefined && currentTask !== abortController) ||
            !isEligibleActiveProjectTrack(taskIdentity)
        ) {
            return false;
        }

        if (abortController.signal.aborted) {
            return restoreCancelledFreeze({ trackId, pendingFreeze, settled: previousFreeze, scope });
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        notifyUser(errorMessage, 'error');
        const failedTrack = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
        if (!failedTrack || !pendingFreeze || !freezeStateSnapshotMatches(failedTrack, pendingFreeze)) {
            return false;
        }
        const expected = captureFreezeStateSnapshot(failedTrack);
        const replacement: typeof previousFreeze = {
            ...previousFreeze,
            freezeState: { ...previousFreeze.freezeState, status: 'error', errorMessage },
        };
        const hasAuthorityFor = (snapshot: typeof expected): boolean => {
            const current = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
            return (
                !abortController.signal.aborted &&
                isRegisteredFreezeTask(taskIdentity) &&
                projectRevisionMatchesLiveIgnoringSaveWrites(sourceRevision) &&
                current !== undefined &&
                valuesEqual(captureFreezeStateSnapshot(current), snapshot)
            );
        };
        // The refused Freeze aborts its captured transaction. Settle its diagnostic
        // through a separate non-undoable typed action, never as a successful Freeze.
        // Admission checks the pending aggregate; commit checks the replacement the
        // handler staged, retaining authority through the transaction's final yield.
        try {
            await executeAppAction(
                {
                    type: 'restoreFreezeState',
                    payload: { trackId, expected, replacement },
                },
                {
                    skipMacroRecording: true,
                    shouldExecute: () => hasAuthorityFor(expected),
                    shouldCommit: () => hasAuthorityFor(replacement),
                }
            );
        } catch (settlementError) {
            const settlementMessage =
                settlementError instanceof Error ? settlementError.message : String(settlementError);
            const diagnosticApplied = isAppActionCommittedError(settlementError);
            notifyUser(
                `Freeze failed: ${errorMessage}. ${diagnosticApplied ? 'The failure diagnostic reached the project, but completion could not be confirmed' : 'Could not save the failure diagnostic'}: ${settlementMessage}`,
                'error'
            );
            logger.error(
                new AggregateError(
                    [error, settlementError],
                    diagnosticApplied
                        ? 'Freeze render failed and failure diagnostic completion could not be confirmed'
                        : 'Freeze render and failure diagnostic save failed'
                )
            );
        }
        return false;
    } finally {
        clearFreezeTaskIfCurrent(trackId, abortController);
    }

    return true;
}
