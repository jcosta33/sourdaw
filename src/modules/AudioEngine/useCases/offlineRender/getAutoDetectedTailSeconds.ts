import { deriveEffectiveAudibility, trackStore, type Track } from '#/modules/Arrangement/stores';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { resolveFrozenBufferTail } from '#/utils/frozenBufferTail';

import { estimateRenderTailSeconds, type TailDeclarationLike } from '../../services/estimateRenderTailSeconds';

import { projectDeviceTails } from './projectDeviceTails';
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
function projectDevices(track: Track, tailForDeviceType: DeviceTailLookup) {
    return projectDeviceTails({ devices: track.devices, tailForDeviceType });
}

/**
 * The track's routing edges, carried in so the estimator can follow the
 * cascade from a track into the bus chain it plays through.
 *
 * Projected here rather than looked up there for the same reason the tail
 * declarations are: the service stays pure and evaluates only what it is handed.
 */
function projectRouting(track: Track) {
    return {
        id: track.id,
        outputId: track.outputId,
        sends: track.sends.map((send) => ({ busId: send.busId })),
    };
}

function projectTrack(track: Track, tailForDeviceType: DeviceTailLookup) {
    if (track.freezeState.status !== 'frozen') {
        return { ...projectRouting(track), devices: projectDevices(track, tailForDeviceType) };
    }

    const baked = resolveFrozenBufferTail(track.freezeState.renderSettings);
    if (baked.known) {
        return { ...projectRouting(track), devices: [], bakedTailSeconds: baked.seconds };
    }

    // Unknown baked tail. The device chain is a proxy — freeze bypasses the
    // chain but does not delete it — yet the chain can equally fail to answer:
    // an empty insert list, every device bypassed, or devices that declare no
    // tail all sum to zero. Those are "cannot answer", not "genuinely no tail",
    // and collapsing the two is what reserved nothing for a decaying buffer.
    //
    // So the proxy is floored, never trusted downward.
    // `uncappedSeconds`, not `seconds`: a chain that already exceeds the ceiling
    // would otherwise re-enter as exactly the ceiling, and the outer clamp check
    // (`> MAX_AUTO_TAIL_SECONDS`) would read false for a truncated estimate.
    const chainOnly = estimateRenderTailSeconds([
        { devices: projectDevices(track, tailForDeviceType) },
    ]).uncappedSeconds;
    return {
        ...projectRouting(track),
        devices: [],
        bakedTailSeconds: Math.max(chainOnly, baked.atLeastSeconds),
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
        // A frozen buffer is wired to `trackGainNode` — the fader — which sits
        // downstream of `preFaderTap`, so it bypasses the device chain and the
        // tap the exception below depends on. Frozen and pre-fader-audible are
        // mutually exclusive; a muted frozen track reaches the mix by neither
        // path.
        if (track.freezeState.status === 'frozen') {
            return false;
        }

        // Silenced by its own mute, but `postFaderGain` sits downstream of the
        // pre-fader send tap, so a cue send keeps feeding its bus and stays
        // audible. Post-fader-only sends sit after the mute and carry nothing.
        return track.sends.some((send) => send.preFader && busIds.has(send.busId));
    });

    return estimateRenderTailSeconds(contributing.map((track) => projectTrack(track, tailForDeviceType)));
}
