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
 * has to exist by the time it is read. The engine therefore renders the real
 * arrangement — and still contributes nothing audible, because the monitor
 * above it is shadowed: the device callback writes true zeros however full the
 * timeline is (`crates/daw-engine/src/audio_thread.rs`, `DeviceRenderer`).
 * That is the whole reason the shadow landed first (#3123): scheduling a real
 * programme could not otherwise be done without doubling the Web Audio path,
 * which stays the live product path until the cutover. What starting the
 * engine *also* changes is plugin hosting: `load_plugin` takes its
 * engine-owned branch only while an engine runs, and until one does it warns
 * that the plugin will not process audio
 * (`crates/sourdaw-native/src/commands/plugins.rs`).
 *
 * **No tempo or time signature.** `set-transport` here carries `playing` and
 * the song position and nothing else — the field split the native transport
 * ownership law draws (`crates/sourdaw-native/src/commands/graph.rs`): tempo
 * and time signature are a different native command with a different producer.
 *
 * ── Which strips are built as contributing audio ──────────────────────────
 *
 * `contributesAudio` asks whether anything a strip produces can reach the
 * output ({@link AudioGraphCreateTrackStripCommand}), and the native mapper
 * reads it as permission to *refuse*: `map_device` fails the whole batch when
 * the flag is true and any device on the strip has no native body
 * (`crates/sourdaw-native/src/commands/graph.rs`). A refusal is whole-batch, so
 * one WASM device anywhere in the project would cost the session every strip it
 * has.
 *
 * The derivation is therefore per strip and has two terms, both necessary:
 *
 *   1. **The strip plays something.** Only a track can: `schedule-clip`
 *      refuses a bus by name, so a bus is always false — the same answer
 *      `renderOfflineWithNativeEngine` gives it.
 *   2. **Its whole chain is native-representable.** A track carrying a WASM
 *      built-in keeps `false` and still schedules its clips. What that costs is
 *      the chain, which `map_device` then omits and the strip report says is
 *      absent — and it costs nothing audible, because a shadowed session is
 *      where those clips play. Widening the native registry is #3124's work,
 *      not a producer's.
 *
 * An externally hosted plugin is the one device whose native body is not a
 * property of the project at all. `map_device` splices in the engine-owned
 * instance the native side already holds, so such a device has a native body
 * exactly when the engine reports the instance attached — which is why
 * {@link LiveGraphTopologyInput.attachedInstanceIds} is an input rather than a
 * rule. The producer therefore reads attach state as of the batch it builds,
 * and the first batch to attach an instance is by construction mapped before
 * the engine holds it: `apply_graph_commands` captures its plugin lookup ahead
 * of the fence and attaches dormant instances behind it. Binding that instance
 * takes a further batch, which is the caller's business
 * (`startNativeLiveGraphSession`), never a second reading here.
 *
 * A frozen track is the one place the chain is dropped rather than judged: its
 * bake already contains the processing (see `projectLiveGraphProgramme`), so
 * the strip is built with no devices at all, which is both faithful and
 * trivially representable.
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

import { type LiveGraphProgramme } from './projectLiveGraphProgramme';

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
    /** What each strip plays, from {@link projectLiveGraphProgramme}. */
    programme: LiveGraphProgramme;
}>;

/**
 * The one built-in device type `daw-engine` builds a body for, matched the way
 * `no_native_body` matches it. Stated here because the producer's whole job is
 * to emit a batch the engine takes: a second, looser reading of what is
 * representable is how `contributesAudio` starts refusing sessions.
 */
const NATIVE_DEVICE_TYPE = 'knead';

function hasNativeBody(device: AudioGraphDeviceChain[number], attachedInstanceIds: ReadonlySet<string>): boolean {
    const externalInstanceId = device.externalInstanceId;
    if (externalInstanceId !== undefined) {
        return attachedInstanceIds.has(externalInstanceId);
    }
    // An external plugin the host has not resolved to an instance names nothing
    // the engine could be holding, so no attach state can answer for it.
    if (device.externalPluginId !== undefined) {
        return false;
    }
    return device.type.toLowerCase() === NATIVE_DEVICE_TYPE;
}

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
    attachedInstanceIds: ReadonlySet<string>;
}): AudioGraphCommand {
    const { track, state, programme, attachedInstanceIds } = input;
    // A bake replaces the chain rather than feeding it — see the header.
    const devices: AudioGraphDeviceChain = programme.bakedStripIds.has(track.id) ? [] : track.devices;
    const plays = (programme.playbacksByStripId.get(track.id)?.length ?? 0) > 0;
    // Live playback always honours a mute the engineer pressed; only an
    // export chooses otherwise, and only for stems.
    const shared = {
        name: track.name,
        state,
        devices,
        contributesAudio: plays && devices.every((device) => hasNativeBody(device, attachedInstanceIds)),
        honorMuted: true,
    } as const;
    return track.kind === 'bus'
        ? { kind: 'create-bus-strip', busId: track.id, ...shared }
        : { kind: 'create-track-strip', trackId: track.id, ...shared };
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
        programme,
    } = input;

    const busStripIds = new Set(stripTracks.filter((track) => track.kind === 'bus').map((track) => track.id));
    const trackStripIds = new Set(stripTracks.filter((track) => track.kind !== 'bus').map((track) => track.id));

    const strips = stripTracks.map((track) =>
        createStripCommand({
            track,
            state: stripState({ track, soloGatedTrackIds, vcaMultiplierByTrackId }),
            programme,
            attachedInstanceIds,
        })
    );
    const routes = stripTracks.flatMap((track) => routingCommands({ track, busStripIds, trackStripIds }));
    // Walked in project order rather than over the programme's own map, so the
    // command stream's order is the arrangement's and not a hash iteration.
    const playbacks = stripTracks.flatMap((track) =>
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
        ...strips,
        ...routes,
        ...playbacks,
    ];
}
