/**
 * Project truth as one live `AudioGraphCommand` batch (#3066, D3.c.4a).
 *
 * The first production producer of live graph commands. It speaks the same
 * vocabulary the desktop export already speaks
 * (`offlineRender/renderOfflineWithNativeEngine.ts`) and decides routing with
 * its law (`resolveOutputTarget`), because a second precedence for "which of
 * master, a bus or a track does this output id name" is how the live and the
 * bounced mix start disagreeing about where a strip goes.
 *
 * ── What this slice produces, and what it deliberately does not ───────────
 *
 * **Topology**: one strip per live track and bus, carrying its mixer state and
 * its device chain in project order, then its output route and its sends.
 *
 * **A monitor mode**, ahead of all of it. It is not topology, but it belongs
 * in this batch and only here: the batch applies whole at one block boundary,
 * so an engine can never render a block holding this session's material
 * without also holding the mode that says whether that material may be heard.
 *
 * **The programme**, projected by `projectLiveGraphProgramme` and emitted here
 * as `schedule-clip` after the routes, because a playback names a strip that
 * has to exist by the time it is read. An audible session emits only the
 * playbacks of the strips it carries: the strips it does not carry are the ones
 * Web Audio is still sounding, and scheduling those on both engines is a
 * doubled mix. A shadowed session emits the whole programme instead, because
 * nothing it holds can be heard — the device callback writes true zeros however
 * full the timeline is (`crates/daw-engine/src/audio_thread.rs`,
 * `DeviceRenderer`), which is what made scheduling a real programme safe before
 * any of it was audible (#3123). What starting the engine *also* changes is
 * plugin hosting: `load_plugin` takes its engine-owned branch only while an
 * engine runs, and until one does it warns that the plugin will not process
 * audio (`crates/sourdaw-native/src/commands/plugins.rs`).
 *
 * **No tempo or time signature.** `set-transport` here carries `playing` and
 * the song position and nothing else — the field split the native transport
 * ownership law draws (`crates/sourdaw-native/src/commands/graph.rs`): tempo
 * and time signature are a different native command with a different producer.
 *
 * ── Which strips this engine is the carrier for ───────────────────────────
 *
 * Playback is carried by two engines at once while the native one is still
 * growing, and which of them sounds a given track is decided per strip by the
 * carrier law in `stripCarriers.ts`. That module holds the whole rule — its
 * ordering, its reasons, and its recursion over routes and sends — and this
 * producer only applies the answer.
 *
 * The split is per strip rather than one global master switch because a single
 * project mixes both kinds. A synth or a WASM built-in has no native body, so a
 * switch that put the whole mix on the native engine would silence those
 * tracks; a switch back would silence every external plugin, which only the
 * native engine hosts. Only a per-strip answer lets the two play together.
 *
 * `contributesAudio` on a track strip is exactly that answer
 * ({@link AudioGraphCreateTrackStripCommand}), and it is the single record of
 * it: the session reads the carried set back off the `create-track-strip`
 * commands carrying `contributesAudio: true`, so the flag this batch states and
 * the Web Audio exits the session closes cannot disagree. The native mapper
 * reads the flag as permission to *refuse* — `map_device` fails the whole batch
 * when it is true and any device on the strip has no native body
 * (`crates/sourdaw-native/src/commands/graph.rs`) — which is the other half of
 * why the law only calls a strip native when it can build every device on every
 * path out of it.
 *
 * A bus strip is always `false`. Buses are shared between the carriers: a
 * native-carried track feeds the native bus while a web-carried one feeds the
 * Web Audio bus of the same name, and the two sum at the hardware output. A bus
 * that claimed to contribute audio would put its own chain on the whole-batch
 * refusal path for material it does not itself play.
 *
 * ── Bus fidelity ──────────────────────────────────────────────────────────
 *
 * A native bus strip holds the same mixer state a track strip does: fader,
 * pan, mute, and solo gate. The producer sends the project's real values.
 * Bus-sourced sends are still dropped — the native strip has no send taps.
 */

import { type Track } from '#/modules/Arrangement/stores';

import {
    type AudioGraphCommand,
    type AudioGraphDeviceChain,
    type AudioGraphStripState,
} from '../../models/AudioGraphBackend';
import { resolveOutputTarget } from '../offlineRender/resolveOutputTarget';

import { projectDeviceForNativeBody } from './projectDeviceForNativeBody';
import { type LiveGraphProgramme } from './projectLiveGraphProgramme';
import { projectStripCarriers, type StripCarrier } from './stripCarriers';

export type LiveGraphTransportState = Readonly<{
    playing: boolean;
    /** Absolute position on the engine's clock, in seconds. */
    positionSeconds: number;
}>;

/**
 * Whether this session's engine is allowed to reach the speakers.
 *
 * `shadowed` is a rendering engine that contributes nothing audible — the
 * state a native session runs in while Web Audio is the product path, and the
 * one that makes scheduling a real programme safe before the cutover.
 * `audible` is the cutover itself.
 */
export type LiveGraphMonitorMode = 'shadowed' | 'audible';

export type LiveGraphTopologyInput = Readonly<{
    /** Every track and bus the live engine builds a strip for, in project order. */
    stripTracks: readonly Track[];
    /**
     * The strips the solo law is currently silencing. Distinct from `muted`
     * because the gates sit on opposite sides of the pre-fader send tap, which
     * is the whole reason the contract carries two.
     */
    soloGatedTrackIds: ReadonlySet<string>;
    /** A track's VCA group master as a plain multiplier; absent means `1`. */
    vcaMultiplierByTrackId: ReadonlyMap<string, number>;
    /**
     * The external plugin instances the native engine currently owns.
     *
     * The only thing that gives an `external-plugin` device a native body: the
     * mapper splices in an engine-owned instance and has nothing to splice for
     * one the engine has not taken. See the header for why this is state read
     * per batch rather than a property of the device.
     */
    attachedInstanceIds: ReadonlySet<string>;
    transport: LiveGraphTransportState;
    /** Whether this session's engine may reach the speakers at all. */
    monitor: LiveGraphMonitorMode;
    /**
     * Where the master fader stands, as a clamped linear amplitude.
     *
     * A strip this engine carries leaves through the native device and never
     * crosses the Web Audio master fader, so the level has to travel with the
     * topology or the two carriers play the same project at two levels.
     */
    masterGain: number;
    /** What each strip plays, from {@link projectLiveGraphProgramme}. */
    programme: LiveGraphProgramme;
    /**
     * The tracks whose Web Audio strip is receiving a live input signal.
     *
     * An input a musician is monitoring reaches the Web Audio strip and nothing
     * else, so the native engine cannot be that track's carrier however
     * representable its chain is. Read by the carrier law rather than derived
     * here, for the same reason the attach state is.
     */
    inputMonitoredTrackIds: ReadonlySet<string>;
}>;

function stripState(input: {
    track: Track;
    soloGatedTrackIds: ReadonlySet<string>;
    vcaMultiplierByTrackId: ReadonlyMap<string, number>;
}): AudioGraphStripState {
    const { track, soloGatedTrackIds, vcaMultiplierByTrackId } = input;
    const vcaMultiplier = vcaMultiplierByTrackId.get(track.id) ?? 1;
    return {
        gain: track.gain,
        pan: track.pan,
        muted: track.muted,
        soloGated: soloGatedTrackIds.has(track.id),
        vcaMultiplier,
    };
}

function createStripCommand(input: {
    track: Track;
    state: AudioGraphStripState;
    programme: LiveGraphProgramme;
    carriers: ReadonlyMap<string, StripCarrier>;
}): AudioGraphCommand {
    const { track, state, programme, carriers } = input;
    // A bake replaces the chain rather than feeding it — see the header.
    const devices: AudioGraphDeviceChain = programme.bakedStripIds.has(track.id)
        ? []
        : track.devices.map(projectDeviceForNativeBody);
    // Live playback always honours a mute the engineer pressed; only an
    // export chooses otherwise, and only for stems.
    const shared = { name: track.name, state, devices, honorMuted: true } as const;
    return track.kind === 'bus'
        ? { kind: 'create-bus-strip', busId: track.id, ...shared, contributesAudio: false }
        : {
              kind: 'create-track-strip',
              trackId: track.id,
              ...shared,
              contributesAudio: carriers.get(track.id)?.carrier === 'native',
          };
}

/**
 * The sends the native graph has a path for.
 *
 * Two kinds are dropped rather than sent, because the mapper refuses the *whole*
 * batch over either one and a declined batch is a play button that starts no
 * engine at all. See `admittedSendBusIds.ts` for which two — that module
 * states the same admission as a standalone predicate for
 * `projectLiveAutomationWrites.ts`'s own admission of send-level automation
 * targets, so a send this function drops carries no `add-send` command and a
 * lane automating it must not receive writes either.
 */
function sendCommands(input: { track: Track; busStripIds: ReadonlySet<string> }): AudioGraphCommand[] {
    const { track, busStripIds } = input;
    if (track.kind === 'bus') {
        return [];
    }
    return track.sends
        .filter((send) => busStripIds.has(send.busId))
        .map((send): AudioGraphCommand => ({
            kind: 'add-send',
            trackId: track.id,
            busId: send.busId,
            tap: send.preFader ? 'pre-fader' : 'post-fader',
            level: send.level,
        }));
}

function routingCommands(input: {
    track: Track;
    busStripIds: ReadonlySet<string>;
    trackStripIds: ReadonlySet<string>;
}): AudioGraphCommand[] {
    const { track, busStripIds, trackStripIds } = input;
    return [
        {
            kind: 'set-track-output',
            trackId: track.id,
            target: resolveOutputTarget({
                outputId: track.outputId,
                busStripIds,
                trackStripIds,
            }),
        },
        ...sendCommands({ track, busStripIds }),
    ];
}

/**
 * One batch's worth of commands, in application order.
 *
 * The monitor mode first, because nothing after it may be audible before it is
 * stated. Then the transport, because `set-transport` is a *locate*: the native
 * mapper follows it with a `SeekFrames`, and a seek cancels every mixer write
 * stamped at or past the frame it lands on (`RampedParam::cancel_from` in
 * `crates/daw-engine/src/timeline.rs`). A strip states its fader, pan and send
 * levels as writes stamped at frame 0, so a transport emitted *after* the
 * strips locates to the session's position and drops the whole mix on its way
 * — every strip left at the engine's default. Locating first is the only order
 * under which the state a strip declares survives the batch that declares it.
 *
 * The master level rides in the same opening group, behind the monitor gate: it
 * is what every strip in this batch will be heard through, so it is stated
 * before anything can sound. Its position in the batch is otherwise free — the
 * engine takes it as a target for a smoother rather than as a stamped write, so
 * no locate can cancel it and no order can strand it.
 *
 * Then every strip before any route, because a send names a bus that has to
 * exist by the time it is read; then the programme, which names a strip for the
 * same reason. Clip placement is in absolute timeline frames and a seek touches
 * no clip, so nothing in the programme depends on following the locate.
 *
 * The batch applies whole, at one block boundary, so the engine never renders a
 * block holding this session's material without also holding its monitor mode.
 */
export function projectLiveGraphTopology(input: LiveGraphTopologyInput): readonly AudioGraphCommand[] {
    const {
        stripTracks,
        soloGatedTrackIds,
        vcaMultiplierByTrackId,
        attachedInstanceIds,
        transport,
        monitor,
        masterGain,
        programme,
        inputMonitoredTrackIds,
    } = input;

    const busStripIds = new Set(stripTracks.filter((track) => track.kind === 'bus').map((track) => track.id));
    const trackStripIds = new Set(stripTracks.filter((track) => track.kind !== 'bus').map((track) => track.id));
    const carriers = projectStripCarriers({
        stripTracks,
        attachedInstanceIds,
        programme,
        inputMonitoredTrackIds,
    });
    // A shadowed engine cannot double anything, so it takes the whole
    // arrangement; an audible one takes only what Web Audio has stopped
    // sounding for it.
    const schedulesStrip = (trackId: string): boolean =>
        monitor === 'shadowed' || carriers.get(trackId)?.carrier === 'native';

    const strips = stripTracks.map((track) =>
        createStripCommand({
            track,
            state: stripState({ track, soloGatedTrackIds, vcaMultiplierByTrackId }),
            programme,
            carriers,
        })
    );
    const routes = stripTracks.flatMap((track) => routingCommands({ track, busStripIds, trackStripIds }));
    // Walked in project order rather than over the programme's own map, so the
    // command stream's order is the arrangement's and not a hash iteration.
    const playbacks = stripTracks
        .filter((track) => schedulesStrip(track.id))
        .flatMap((track) =>
            (programme.playbacksByStripId.get(track.id) ?? []).map((playback): AudioGraphCommand => ({
                kind: 'schedule-clip',
                playback,
            }))
        );

    return [
        { kind: 'set-monitor-shadow', shadowed: monitor === 'shadowed' },
        {
            kind: 'set-transport',
            playing: transport.playing,
            positionSeconds: transport.positionSeconds,
        },
        { kind: 'set-master-gain', gain: masterGain },
        ...strips,
        ...routes,
        ...playbacks,
    ];
}
