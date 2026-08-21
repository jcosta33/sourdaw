import { captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';
import { cacheAudioBuffer, getCompensationDelay, getDeviceChainTailSeconds } from '#/modules/AudioEngine/useCases';
import { getAutomationLanes } from '#/modules/Automation/useCases';
import { projectStore } from '#/modules/Project/stores';
import { FREEZE_BAKE_VERSION } from '#/utils/frozenBufferTail';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { updateTrack } from '../../repositories/track/updateTrack';
import { computeTrackHash } from '../../services/computeTrackHash';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { trackStore } from '../../stores/trackStore';
import { getPluginById } from '../getPluginById';

import { detectSilentBake } from './detectSilentBake';
import { renderTrackOffline, type RenderScheduleTally } from './renderOffline';

export const activeFreezeTasks = new Map<string, AbortController>();

type FreezeTaskIdentity = {
    abortController: AbortController;
    projectId: number;
    trackId: string;
};

function isEligibleActiveProjectTrack({ projectId, trackId }: Omit<FreezeTaskIdentity, 'abortController'>): boolean {
    const activeProject = projectStore.value;
    const activeState = trackStore.value;
    if (!activeProject || activeProject.createdAt !== projectId || !activeState) {
        return false;
    }
    const activeTrack = activeState.tracks.find((candidate) => candidate.id === trackId);
    return (
        activeTrack !== undefined &&
        activeTrack.freezeState.status !== 'frozen' &&
        getTrackEligibility(activeTrack.kind).acceptsFreeze
    );
}

function isCurrentFreezeTask({ abortController, projectId, trackId }: FreezeTaskIdentity): boolean {
    return activeFreezeTasks.get(trackId) === abortController && isEligibleActiveProjectTrack({ projectId, trackId });
}

function clearFreezeTaskIfCurrent(trackId: string, abortController: AbortController): void {
    if (activeFreezeTasks.get(trackId) === abortController) {
        activeFreezeTasks.delete(trackId);
    }
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

    if (activeFreezeTasks.has(trackId)) {
        activeFreezeTasks.get(trackId)!.abort();
    }
    const abortController = new AbortController();
    activeFreezeTasks.set(trackId, abortController);

    updateTrack(trackId, (time) => ({
        ...time,
        freezeState: { ...time.freezeState, status: 'freezing', renderProgress: 0 },
    }));

    try {
        const hash = await computeTrackHash(track.clips, track.devices);
        const taskIdentity = { abortController, projectId: project.createdAt, trackId };
        if (!isCurrentFreezeTask(taskIdentity)) {
            clearFreezeTaskIfCurrent(trackId, abortController);
            return false;
        }

        let startBeat = Infinity;
        let endBeat = -Infinity;
        for (const context of track.clips) {
            if (context.startBeat < startBeat) {
                startBeat = context.startBeat;
            }
            if (context.endBeat > endBeat) {
                endBeat = context.endBeat;
            }
        }

        if (startBeat === Infinity) {
            startBeat = 0;
            endBeat = 1;
        }

        // How far past the content this take has to ring, read from the same
        // device tail declarations the export path evaluates. This used to be a
        // substring test on the device type — 8 beats for an id containing
        // "reverb" or "delay", 4 for anything else — which no descriptor fed, so
        // it could not see the Dutch Oven or Bacteria at all, and which shrank
        // with tempo because beats are not seconds.
        const tailSeconds = getDeviceChainTailSeconds({
            devices: track.devices,
            automationLanes: getAutomationLanes().filter((lane) => lane.trackId === track.id),
            tailForDeviceType: (deviceType) => getPluginById(deviceType)?.tail,
        }).seconds;

        let scheduleTally: RenderScheduleTally = { scheduledNotes: 0, scheduledBuffers: [], withheldDeviceTypes: [] };
        const renderedBuffer = await renderTrackOffline(track, startBeat, endBeat, {
            tailSeconds,
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

        if (!isCurrentFreezeTask(taskIdentity)) {
            clearFreezeTaskIfCurrent(trackId, abortController);
            return false;
        }
        clearFreezeTaskIfCurrent(trackId, abortController);

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
            // `freezeState.status === 'error'` is rendered nowhere, so recording
            // it alone would tell no one. Notify on the same channel a dropped
            // offline device uses, and report the refusal as a non-write:
            // `handleFreezeTrack` maps a `true` here to `{status: 'written'}`,
            // which would file a refusal as an undoable edit.
            notifyUser(silentBake.message, 'error');
            scope(() => {
                updateTrack(trackId, (time) => ({
                    ...time,
                    freezeState: { status: 'error', errorMessage: silentBake.message },
                }));
            });
            return false;
        }

        const renderedAt = Date.now();
        // Resolved by the command layer when this runs as an action, so the handler's
        // `describe()` can guard its inverse on the exact take this run produces.
        const freezeId = freezeIdOverride ?? `freeze-${trackId}-${String(renderedAt)}`;
        cacheAudioBuffer({ buffer: renderedBuffer, bufferId: freezeId, freezeProjectId: project.createdAt });

        // FX-4 residual — pin the compensation the chain carried while the
        // buffer was baked. Frozen playback compensates against this, so a later
        // plugin-latency change cannot drift the frozen take out of alignment
        // (nothing marks a frozen track stale on a latency change).
        const compensationSeconds = getCompensationDelay(trackId);

        scope(() => {
            updateTrack(trackId, (time) => ({
                ...time,
                frozen: true,
                frozenBufferId: freezeId,
                freezeState: {
                    status: 'frozen',
                    freezeId,
                    frozenBufferId: freezeId,
                    sourceContentHash: hash,
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
        clearFreezeTaskIfCurrent(trackId, abortController);
        if (
            (currentTask !== undefined && currentTask !== abortController) ||
            !isEligibleActiveProjectTrack({ projectId: project.createdAt, trackId })
        ) {
            return false;
        }

        if (abortController.signal.aborted) {
            // User cancelled
            scope(() => {
                updateTrack(trackId, (time) => ({
                    ...time,
                    freezeState: { status: 'unfrozen' },
                }));
            });
            return true;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        notifyUser(errorMessage, 'error');
        scope(() => {
            updateTrack(trackId, (time) => ({
                ...time,
                freezeState: {
                    status: 'error',
                    errorMessage,
                },
            }));
        });
        return false;
    }

    return true;
}
