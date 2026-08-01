import { cacheAudioBuffer, getCompensationDelay, getDeviceChainTailSeconds } from '#/modules/AudioEngine/useCases';
import { FREEZE_BAKE_VERSION } from '#/utils/frozenBufferTail';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { updateTrack } from '../../repositories/track/updateTrack';
import { computeTrackHash } from '../../services/computeTrackHash';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { trackStore } from '../../stores/trackStore';
import { getPluginById } from '../getPluginById';

import { detectSilentBake } from './detectSilentBake';
import { renderTrackOffline } from './renderOffline';

export const activeFreezeTasks = new Map<string, AbortController>();

export async function freezeTrack(trackId: string): Promise<boolean> {
    const state = trackStore.value;
    if (!state) {
        return false;
    }

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
            tailForDeviceType: (deviceType) => getPluginById(deviceType)?.tail,
        }).seconds;

        const renderedBuffer = await renderTrackOffline(track, startBeat, endBeat, {
            tailSeconds,
            // The buffer is replayed through this track's own fader and panner —
            // live attaches it to `preFaderTap`, the mixdown to the fader node —
            // so those two values must stay out of the print or they are applied
            // twice.
            targetMixer: 'keepLive',
            abortSignal: abortController.signal,
            onProgress: (param) => {
                updateTrack(trackId, (time) => ({
                    ...time,
                    freezeState: { ...time.freezeState, renderProgress: param },
                }));
            },
        });

        activeFreezeTasks.delete(trackId);

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
            startBeat,
            endBeat,
            // `targetMixer: 'keepLive'` prints the target at unity, so the
            // track's own fader is not part of this render and cannot excuse a
            // silent result.
            bakedFaderGain: 1,
            operation: 'Freeze',
        });
        if (silentBake.silentBake) {
            // `freezeState.status === 'error'` is not rendered anywhere, so the
            // throw below records the reason without telling anyone. Notify on
            // the same channel a dropped offline device uses.
            notifyUser(silentBake.message, 'error');
            throw new Error(silentBake.message);
        }

        const freezeId = `freeze-${trackId}-${Date.now()}`;
        cacheAudioBuffer({ buffer: renderedBuffer, bufferId: freezeId });

        // FX-4 residual — pin the compensation the chain carried while the
        // buffer was baked. Frozen playback compensates against this, so a later
        // plugin-latency change cannot drift the frozen take out of alignment
        // (nothing marks a frozen track stale on a latency change).
        const compensationSeconds = getCompensationDelay(trackId);

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
                renderedAt: Date.now(),
            },
        }));
    } catch (error) {
        activeFreezeTasks.delete(trackId);

        if (abortController.signal.aborted) {
            // User cancelled
            updateTrack(trackId, (time) => ({
                ...time,
                freezeState: { status: 'unfrozen' },
            }));
            return true;
        }

        updateTrack(trackId, (time) => ({
            ...time,
            freezeState: {
                status: 'error',
                errorMessage: error instanceof Error ? error.message : String(error),
            },
        }));
    }

    return true;
}
