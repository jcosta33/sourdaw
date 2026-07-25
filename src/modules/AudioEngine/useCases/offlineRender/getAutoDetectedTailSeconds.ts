import { trackStore, type Track } from '#/modules/Arrangement/stores';

import { estimateRenderTailSeconds, type TailDeclarationLike } from '../../services/estimateRenderTailSeconds';

type DeviceTailLookup = (deviceType: string) => TailDeclarationLike | undefined;

type GetAutoDetectedTailSecondsInput = {
    /**
     * Resolves a device type to its declared tail. Injected rather than looked
     * up here: the descriptors live in Arrangement's models, and AudioEngine
     * importing Arrangement's use-case barrel closes a module cycle (Arrangement's
     * freeze/bounce use cases already import AudioEngine). The caller, which sits
     * downstream of both, supplies the lookup.
     */
    tailForDeviceType: DeviceTailLookup;
    /**
     * Whether this export silences muted tracks. Mirrors `createOfflineTrackStrip`'s
     * own `honorMuted`: a mixdown bakes mute in, a stem set deliberately does not.
     */
    honorMuted: boolean;
};

type TailContributingTrack = Pick<Track, 'id' | 'kind' | 'muted' | 'disabled' | 'freezeState' | 'sends'>;

/**
 * Can this track's device chain still put audio into the export?
 *
 * Only tracks that answer yes may lengthen the render. A tail reserved for a
 * chain that produces nothing is pure silence, rendered and then encoded into
 * every requested format.
 */
function contributesTail(track: TailContributingTrack, busIds: ReadonlySet<string>, honorMuted: boolean): boolean {
    // Frozen: `scheduleTrackClips` wires the frozen buffer straight to
    // `trackGainNode`, skipping `trackInputNode` to bypass device processing.
    // The devices provably never run, in any export mode.
    if (track.freezeState.status === 'frozen') {
        return false;
    }

    // Disabled tracks are filtered out before any strip is built.
    if (track.disabled) {
        return false;
    }

    if (!honorMuted || !track.muted) {
        return true;
    }

    // Muted, in an export that honours mute. The chain still runs — the strip
    // silences it afterwards at `postFaderGain` — but that gain sits downstream
    // of the pre-fader send tap, so a cue send keeps feeding its bus and stays
    // audible. Such a track must keep its tail; one whose sends are all
    // post-fader, or land on no bus, reaches nothing and must not.
    return track.sends.some((send) => send.preFader && busIds.has(send.busId));
}

/**
 * Read the current project tracks and return the longest device-chain tail.
 *
 * This is the seam that carries each device's declared tail from its
 * descriptor into the pure estimator, and the place where project truth —
 * mute, freeze, disable, routing — decides which chains count at all. The
 * estimator is pure and sees only device lists, so it cannot make that call.
 */
export function getAutoDetectedTailSeconds({
    tailForDeviceType,
    honorMuted,
}: GetAutoDetectedTailSecondsInput): ReturnType<typeof estimateRenderTailSeconds> {
    const tracks = trackStore.value?.tracks ?? [];
    const busIds = new Set(tracks.filter((track) => track.kind === 'bus').map((track) => track.id));

    return estimateRenderTailSeconds(
        tracks
            .filter((track) => contributesTail(track, busIds, honorMuted))
            .map((track) => ({
                devices: track.devices.map((device) => ({
                    type: device.type,
                    parameterValues: device.parameterValues,
                    bypassed: device.bypassed,
                    tail: tailForDeviceType(device.type),
                })),
            }))
    );
}
