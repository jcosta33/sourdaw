/**
 * Project truth as one live `AudioGraphCommand` batch (#3066, D3.c.4a).
 *
 * The first production producer of live graph commands. It speaks the same
 * vocabulary the desktop export already speaks
 * (`offlineRender/renderOfflineWithNativeEngine.ts`) and reuses its routing law
 * outright (`resolveOutputTarget`), because a second precedence for "which of
 * master, a bus or a track does this output id name" is how the live and the
 * bounced mix start disagreeing about where a strip goes.
 *
 * ── What this slice produces, and what it deliberately does not ───────────
 *
 * **Topology**: one strip per live track and bus, carrying its mixer state and
 * its device chain in project order, then its output route and its sends. That
 * is the whole batch.
 *
 * **No programme.** No `schedule-clip` is emitted, and that is a scope
 * decision with an audible consequence worth stating: an engine holding this
 * topology and no clips renders silence
 * (`crates/daw-engine/src/audio_thread.rs` — `process_block` on an engine with
 * nothing scheduled), so applying it cannot double the Web Audio path, which
 * stays the live product path. What starting the engine *does* change is
 * plugin hosting: `load_plugin` takes its engine-owned branch only while an
 * engine runs, and until one does it warns that the plugin will not process
 * audio (`crates/sourdaw-native/src/commands/plugins.rs`).
 *
 * **No tempo or time signature.** `set-transport` here carries `playing` and
 * the song position and nothing else — the field split the native transport
 * ownership law draws (`crates/sourdaw-native/src/commands/graph.rs`): tempo
 * and time signature are a different native command with a different producer.
 *
 * ── Why every strip is built as contributing no audio ─────────────────────
 *
 * `contributesAudio` asks whether anything a strip produces can reach the
 * output ({@link AudioGraphCreateTrackStripCommand}). Nothing is scheduled on
 * any strip in this batch, so `false` is literally what is true, and it is the
 * flag that keeps a device the native side cannot build — a WASM device, or a
 * plugin the host still owns — from refusing a batch whose whole purpose is to
 * mirror a topology. The value is stored per strip and no command edits it, so
 * the slice that starts scheduling clips raises it the only way it can be
 * raised: by building the strip again in a replacing batch, which is what every
 * play already does.
 *
 * ── Bus fidelity ──────────────────────────────────────────────────────────
 *
 * A native bus strip is a fader over a summing point, so the pan, mute and
 * solo gate a project bus carries have nowhere to land; see `stripState`.
 */

import { type Track } from '#/modules/Arrangement/stores';

import { type AudioGraphCommand, type AudioGraphStripState } from '../../models/AudioGraphBackend';
import { resolveOutputTarget } from '../offlineRender/resolveOutputTarget';

export type LiveGraphTransportState = Readonly<{
    playing: boolean;
    /** Absolute position on the engine's clock, in seconds. */
    positionSeconds: number;
}>;

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
    transport: LiveGraphTransportState;
}>;

/**
 * No strip in this batch is scheduled, so none of them can reach the output.
 * Named rather than written as a bare `false` at two call sites, because the
 * value is a claim about this slice and not a per-strip fact.
 */
const NOTHING_IS_SCHEDULED_YET = false;

function stripState(input: {
    track: Track;
    soloGatedTrackIds: ReadonlySet<string>;
    vcaMultiplierByTrackId: ReadonlyMap<string, number>;
}): AudioGraphStripState {
    const { track, soloGatedTrackIds, vcaMultiplierByTrackId } = input;
    const vcaMultiplier = vcaMultiplierByTrackId.get(track.id) ?? 1;
    if (track.kind === 'bus') {
        // A native bus strip is a summing point with a fader: no panner, no
        // mute gate, no solo gate. Sending it any of the three refuses the
        // whole batch by name (`bus-pan-unsupported`, `bus-mute-unsupported`,
        // `bus-solo-gate-unsupported`), which in practice means every session
        // that has anything soloed. So the state carries what a bus can hold,
        // and `honorMuted` says outright that this strip does not honour one.
        // Raising that fidelity is engine work — a bus strip that grows the
        // gates — never a producer that pretends the state crossed.
        return { gain: track.gain, pan: 0, muted: track.muted, soloGated: false, vcaMultiplier };
    }
    return {
        gain: track.gain,
        pan: track.pan,
        muted: track.muted,
        soloGated: soloGatedTrackIds.has(track.id),
        vcaMultiplier,
    };
}

function createStripCommand(input: { track: Track; state: AudioGraphStripState }): AudioGraphCommand {
    const { track, state } = input;
    const shared = {
        name: track.name,
        state,
        devices: track.devices,
        contributesAudio: NOTHING_IS_SCHEDULED_YET,
    } as const;
    return track.kind === 'bus'
        ? { kind: 'create-bus-strip', busId: track.id, ...shared, honorMuted: false }
        : // Live playback always honours a mute the engineer pressed; only an
          // export chooses otherwise, and only for stems.
          { kind: 'create-track-strip', trackId: track.id, ...shared, honorMuted: true };
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
            target: resolveOutputTarget({ outputId: track.outputId, busStripIds, trackStripIds }),
        },
        // A send naming no built bus carries no audio path either way, so it is
        // dropped rather than refused — the same answer the export path gives.
        ...track.sends
            .filter((send) => busStripIds.has(send.busId))
            .map((send): AudioGraphCommand => ({
                kind: 'add-send',
                trackId: track.id,
                busId: send.busId,
                tap: send.preFader ? 'pre-fader' : 'post-fader',
                level: send.level,
            })),
    ];
}

/**
 * One batch's worth of commands, in application order: every strip before any
 * route, because a send names a bus that has to exist by the time it is read,
 * and the transport last, because a topology is what it is meant to play.
 */
export function projectLiveGraphTopology(input: LiveGraphTopologyInput): readonly AudioGraphCommand[] {
    const { stripTracks, soloGatedTrackIds, vcaMultiplierByTrackId, transport } = input;

    const busStripIds = new Set(stripTracks.filter((track) => track.kind === 'bus').map((track) => track.id));
    const trackStripIds = new Set(stripTracks.filter((track) => track.kind !== 'bus').map((track) => track.id));

    const strips = stripTracks.map((track) =>
        createStripCommand({ track, state: stripState({ track, soloGatedTrackIds, vcaMultiplierByTrackId }) })
    );
    const routes = stripTracks.flatMap((track) => routingCommands({ track, busStripIds, trackStripIds }));

    return [
        ...strips,
        ...routes,
        {
            kind: 'set-transport',
            playing: transport.playing,
            positionSeconds: transport.positionSeconds,
        },
    ];
}
