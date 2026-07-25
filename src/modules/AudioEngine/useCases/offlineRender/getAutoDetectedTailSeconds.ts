import { deriveEffectiveAudibility, trackStore, type Track } from '#/modules/Arrangement/stores';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { estimateRenderTailSeconds, type TailDeclarationLike } from '../../services/estimateRenderTailSeconds';

import { shouldCreateOfflineStrip } from './shouldCreateOfflineStrip';

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

/**
 * Project one track into the estimator's shape.
 *
 * A frozen track contributes its buffer, not its devices. `scheduleTrackClips`
 * wires the frozen buffer straight to `trackGainNode`, skipping
 * `trackInputNode` to bypass device processing — but freeze baked a tail into
 * that buffer and recorded its length, and `OfflineAudioContext` truncates
 * anything past the frame count. Reading the device list here would describe
 * processing that no longer runs; reading nothing at all would cut the decay
 * the buffer actually carries.
 */
function projectTrack(track: Track, tailForDeviceType: DeviceTailLookup) {
    if (track.freezeState.status === 'frozen') {
        return { devices: [], bakedTailSeconds: track.freezeState.renderSettings?.tailLengthSeconds ?? 0 };
    }

    return {
        devices: track.devices.map((device) => ({
            type: device.type,
            parameterValues: device.parameterValues,
            bypassed: device.bypassed,
            tail: tailForDeviceType(device.type),
        })),
    };
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
    const renderable = tracks.filter((track) => !track.disabled && shouldCreateOfflineStrip(track));

    if (!honorMuted) {
        // Stems carry the session's full content: `exportStems` builds strips
        // with `honorMuted: false`, so mute and solo change nothing about which
        // chains run and every renderable track keeps its tail.
        return estimateRenderTailSeconds(renderable.map((track) => projectTrack(track, tailForDeviceType)));
    }

    // Audibility is not re-derived here. `deriveEffectiveAudibility` is the same
    // computation the mixdown itself consumes, and it already answers cases a
    // local mute check gets wrong — PFL solo clears mute unconditionally, so a
    // muted-and-soloed track renders in full. A second implementation of "is
    // this audible" would drift from the render exactly there.
    const stripTrackIds = new Set(
        renderable
            .filter((track) => tracks.filter((candidate) => candidate.id === track.id).length === 1)
            .map((track) => track.id)
    );
    const { audibleByTrackId, soloGatedByTrackId } = deriveEffectiveAudibility({
        tracks,
        soloMode: workspaceStore.value?.soloMode ?? 'sip',
        stripTrackIds,
    });

    const contributing = renderable.filter((track) => {
        if (audibleByTrackId.get(track.id) ?? !track.muted) {
            return true;
        }
        // Solo-in-place means "play only the soloed tracks", so a gated track
        // feeds nothing at all, sends included.
        if (soloGatedByTrackId.get(track.id) ?? false) {
            return false;
        }
        // Silenced by its own mute, but `postFaderGain` sits downstream of the
        // pre-fader send tap, so a cue send keeps feeding its bus and stays
        // audible. Post-fader-only sends sit after the mute and carry nothing.
        return track.sends.some((send) => send.preFader && busIds.has(send.busId));
    });

    return estimateRenderTailSeconds(contributing.map((track) => projectTrack(track, tailForDeviceType)));
}
