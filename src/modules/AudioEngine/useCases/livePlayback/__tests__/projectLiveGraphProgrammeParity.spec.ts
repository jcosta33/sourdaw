/**
 * The live projection against the export projection, both rendered (#3068).
 *
 * The live producer and the desktop export are two projections of one project
 * into one command vocabulary. Nothing forces them to agree: they are separate
 * files, they build their batches in different shapes, and a divergence
 * between them is inaudible until a musician bounces a mix that is not the one
 * they were monitoring. This is the check that catches that.
 *
 * ── Why the two are compared bit for bit ──────────────────────────────────
 *
 * Because only the projections differ. Both legs end in the *same* call —
 * `render_graph_offline`, which maps the batch and drives `daw-engine`'s
 * `OfflineRenderer`: the same `AudioScheduler` the live device callback
 * drives, over the same command ring, with the render loop standing in for the
 * device (`crates/daw-engine/src/offline.rs`). One renderer, one arithmetic,
 * one frame grid — so there is no resampling, no rate conversion and no
 * floating-point drift *between the legs* for a tolerance to absorb. Anything
 * but equality is a projection difference, which is the only thing this file
 * exists to find, and a null-test floor would hide the small ones.
 *
 * Three things the live batch carries that the export's does not, and why none
 * of them disturbs that:
 *
 *   - `set-monitor-shadow` is a mode the *device* callback reads
 *     (`DeviceRenderer`, #3123). `render_offline_ops` never consults it — a
 *     bounce is not a monitor — so it maps and changes no rendered frame. The
 *     equality below is the proof of that, not the claim.
 *   - **Two** `set-transport` writes, because that is what a play gesture
 *     actually sends: the topology goes out *parked* (the loop region arrives
 *     with the maps a round trip later, and an engine already rolling would
 *     render that round trip), and a roll follows it. Together they restate the
 *     preamble `render_offline_ops` already pushes — playing, from frame 0 —
 *     and neither may cancel the mix. The first is a locate and leads its
 *     batch, so every strip's writes are queued after it; the second is not a
 *     locate at all, because the engine already stands where it wants it. Both
 *     halves of that law are measured directly by the last two cases here.
 *   - The batch shape: the export applies strips, routes and programme as three
 *     batches; the live producer sends a topology batch and a roll.
 *     `render_graph_offline` maps the accumulated command list either way, so
 *     what is compared is the command *sequence*, which is the thing under
 *     test — and the live sequence is compared in the order and the shape
 *     production emits it, not a convenient single batch.
 *
 * `contributesAudio` also differs on one strip — the export marks every
 * scheduled track true, the live producer marks a track with nothing to play
 * false. It cannot reach the comparison: the flag is read only by `map_device`
 * and stored in the mapping registry, never turned into an engine op
 * (`crates/sourdaw-native/src/commands/graph.rs`), and this fixture is
 * device-free. Its own derivation is spec'd in
 * `projectLiveGraphTopology.spec.ts`.
 *
 * ── Why the harness lives here and not in Rust ────────────────────────────
 *
 * The subject is two TypeScript producers. A Rust test would have to hand-write
 * the batches they emit, which is the very step that could be wrong, and would
 * then prove only that `daw-engine` renders two identical inputs identically —
 * something `offline.rs` already asserts. Driving the real producers and the
 * built addon in one process is what makes the comparison about them.
 *
 * ── What the fixture holds, and what it deliberately does not ─────────────
 *
 * Ordinary clips (one with user fades, one looping), a frozen track, a shaped
 * bus, a track→bus send, a bus routed into a track, and the two clips whose
 * fade endpoints fall outside their own sound — a clip slipped left of its
 * material, and a clip longer than its material.
 *
 * No devices: no built-in has a native body yet (#3124), and both producers
 * degrade a bodiless chain the same way, so a device here would measure
 * nothing. No automation lanes, and `automationMode: 'off'` — writes during
 * playback are a later slice, and the export's recorder would otherwise emit
 * `write-parameter` commands the live producer has no counterpart for. Master
 * gain is unity, because the export applies it after the render, outside the
 * projection under test. No bus-sourced send: both producers drop it, so it
 * would compare nothing.
 *
 * ── The frozen leg's oracle ───────────────────────────────────────────────
 *
 * `renderOfflineWithNativeEngine` never sees a frozen track — the engine
 * selection sends those to the Web Audio renderer — so it has no frozen branch
 * to compare against. The law under test is therefore stated directly: *a
 * frozen track plays its bake as an ordinary clip, anchored at the track's
 * earliest clip start, past the device chain.* The export leg is handed that
 * clip; the live leg is handed the frozen track. Equality is the law holding.
 *
 * ── Skip law ──────────────────────────────────────────────────────────────
 *
 * Needs the built addon and skips without it, under the same three guards
 * `renderOfflineNativeParity.spec.ts` carries: the probed path is anchored to
 * the crate, presence must mean loaded, and the skip is an observable result.
 */

import { Buffer as NodeBuffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';

import { NATIVE_ADDON_FILE } from '../../../../../../electron/native';
import { type AudioGraphCommand } from '../../../models/AudioGraphBackend';
import { deinterleaveStereoPcm } from '../../../repositories/nativeGraph/deinterleaveStereoPcm';
import { type NativeGraphTransport } from '../../../repositories/nativeGraph/nativeGraphTransport';
import { registerNativeTimelineSamples } from '../../../repositories/nativeGraph/nativeTimelineSamplePool';
import { registeredNativeTimelineSampleIds } from '../../../repositories/nativeGraph/registeredNativeTimelineSampleIds';
import { serializeAudioGraphCommandBatch } from '../../../repositories/nativeGraph/serializeAudioGraphCommandBatch';
import {
    type OfflinePpqEndpointProjector,
    type OfflineTempoAtBeatResolver,
} from '../../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { renderOfflineWithNativeEngine } from '../../offlineRender/renderOfflineWithNativeEngine';
import { projectLiveGraphProgramme } from '../projectLiveGraphProgramme';
import { projectLiveGraphTopology } from '../projectLiveGraphTopology';

const SAMPLE_RATE = 48_000;
const TEMPO = 120;
const SECONDS_PER_BEAT = 60 / TEMPO;
/** Long enough to hold every source plus its tail. */
const RENDER_BEATS = 8;
const RENDER_SECONDS = RENDER_BEATS * SECONDS_PER_BEAT;
const FRAME_COUNT = RENDER_SECONDS * SAMPLE_RATE;

// ── The clock, shared by both legs ────────────────────────────────────────

/** Flat tempo, rounded onto the sample grid exactly as production's is. */
const projectPpqEndpoints: OfflinePpqEndpointProjector = ({ startPpq, endPpq, sampleRate }) => {
    const startSamples = Math.round(startPpq * SECONDS_PER_BEAT * sampleRate);
    const endSamples = Math.round(endPpq * SECONDS_PER_BEAT * sampleRate);
    return {
        startSamples,
        endSamples,
        durationSamples: endSamples - startSamples,
        startSeconds: startSamples / sampleRate,
        endSeconds: endSamples / sampleRate,
        durationSeconds: (endSamples - startSamples) / sampleRate,
    };
};
const resolveTempoAtBeat: OfflineTempoAtBeatResolver = () => TEMPO;

// ── The seams: the material cache, and lanes the export must not find ─────

const mocks = vi.hoisted(() => ({ audioBuffers: new Map<string, unknown>() }));

vi.mock('../../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        get: (id: string) => mocks.audioBuffers.get(id),
        has: (id: string) => mocks.audioBuffers.has(id),
        set: () => undefined,
    },
}));

vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Automation/stores')>();
    return { ...actual, automationStore: { value: { lanes: [] } } };
});

/**
 * What the export builds its answer in, and what the fixture's material is.
 * Structural, because jsdom has no `AudioBuffer`.
 */
class StubAudioBuffer {
    readonly length: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
    readonly duration: number;
    private readonly channels: Float32Array[];

    constructor(options: { length: number; numberOfChannels: number; sampleRate: number }) {
        this.length = options.length;
        this.numberOfChannels = options.numberOfChannels;
        this.sampleRate = options.sampleRate;
        this.duration = options.length / options.sampleRate;
        this.channels = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length));
    }

    getChannelData(channel: number): Float32Array {
        const data = this.channels[channel];
        if (!data) {
            throw new Error(`StubAudioBuffer has no channel ${String(channel)}`);
        }
        return data;
    }

    copyToChannel(source: Float32Array, channel: number): void {
        this.getChannelData(channel).set(source);
    }
}

/**
 * Material a null comparison can see: a slow sine, so adjacent frames differ
 * and a one-sample placement error is a nonzero residual rather than a run of
 * equal values that hides it. The two channels differ so a swapped pair shows.
 */
function createMaterial(seconds: number, hertz: number): AudioBuffer {
    const length = Math.round(seconds * SAMPLE_RATE);
    const buffer = new StubAudioBuffer({ length, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let frame = 0; frame < length; frame++) {
        const value = Math.sin((2 * Math.PI * hertz * frame) / SAMPLE_RATE);
        left[frame] = value * 0.5;
        right[frame] = value * -0.35;
    }
    return buffer as unknown as AudioBuffer;
}

// ── The addon, loaded exactly as the export parity spec loads it ──────────

/** The napi surface the in-process transport drives — `SourdawNative` in `addon/mod.rs`. */
type NativeHostAddon = {
    registerTimelineSample: (
        sampleId: string,
        sampleRate: number,
        channels: number,
        pcm: Uint8Array
    ) => Promise<unknown>;
    renderGraphOffline: (batch: unknown, frames: number, sampleRate: number) => Promise<Uint8Array>;
    mapGraphBatch: (prior: unknown, batch: unknown, sampleRate: number, session: unknown) => Promise<unknown>;
};

const NATIVE_CRATE_DIR = join(
    dirname(fileURLToPath(import.meta.url)),
    '..', // __tests__
    '..', // livePlayback
    '..', // useCases
    '..', // AudioEngine
    '..', // modules
    '..', // src
    'crates',
    'sourdaw-native'
);
const NATIVE_ADDON_PATH = join(NATIVE_CRATE_DIR, NATIVE_ADDON_FILE);
const nativeAddonPresent = existsSync(NATIVE_ADDON_PATH);

/**
 * Constructed at module scope, deliberately: an addon that exists on disk but
 * cannot load fails the file here, before any `runIf` turns that into a skip.
 * The constructor opens no audio device — the live engine starts lazily on the
 * first `apply_graph_commands`, which neither leg issues.
 */
const nativeHost: NativeHostAddon | undefined = nativeAddonPresent
    ? (() => {
          const requireAddon = createRequire(import.meta.url);
          const loaded = requireAddon(NATIVE_ADDON_PATH) as {
              SourdawNative: new (onEvent: (...args: unknown[]) => void) => NativeHostAddon;
          };
          return new loaded.SourdawNative(() => undefined);
      })()
    : undefined;

function requireNativeHost(): NativeHostAddon {
    if (!nativeHost) {
        throw new Error('a parity leg ran without the built addon — the skip law above is broken');
    }
    return nativeHost;
}

/** The in-process transport: the production commands, minus the wire. */
function inProcessNativeTransport(host: NativeHostAddon): NativeGraphTransport {
    return {
        async registerTimelineSample(input) {
            return host.registerTimelineSample(
                input.sampleId,
                input.sampleRate,
                input.channels,
                NodeBuffer.from(input.pcm)
            );
        },
        async renderGraphOffline(input) {
            return host.renderGraphOffline(input.batch, input.frames, input.sampleRate);
        },
        async mapGraphBatch(input) {
            return host.mapGraphBatch(input.prior, input.batch, input.sampleRate, input.session ?? null);
        },
        async applyGraphCommands() {
            throw new Error('a parity leg never touches the live engine (apply_graph_commands)');
        },
    };
}

// ── Fixture ───────────────────────────────────────────────────────────────

function createTrack(overrides?: Partial<Track>): Track {
    return {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'hw_out',
        // See the header: automation is a later slice, and `off` is what keeps
        // the export's recorder from emitting writes the live batch lacks.
        automationMode: 'off',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
        ...overrides,
    };
}

function audioClip(
    overrides: Partial<Track['clips'][number]> & { id: string; trackId: string }
): Track['clips'][number] {
    return {
        name: overrides.id,
        startBeat: 0,
        endBeat: 2,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#00ff00',
        locked: false,
        muted: false,
        ...overrides,
    };
}

const BAKE_SECONDS = 1.5;
/** Where the frozen track's earliest clip sits, and therefore where its bake does. */
const BAKE_START_BEAT = 1;

/**
 * The frozen track, as each leg is handed it.
 *
 * `live` is the project's own truth. `export` is the same track with the law
 * under test written out: the bake as an ordinary clip at the track's earliest
 * clip start, running exactly as long as it was baked, past the (absent)
 * chain. Everything else about the strip — id, name, fader, pan, output — is
 * identical, so the bake is the only thing the comparison can be measuring.
 */
function frozenTrack(leg: 'live' | 'export'): Track {
    const shared = { id: 'track-frozen', name: 'Frozen', gain: 0.65, pan: -12 } as const;
    if (leg === 'live') {
        return createTrack({
            ...shared,
            frozen: true,
            freezeState: { status: 'frozen', freezeId: 'freeze-1', frozenBufferId: 'bake-1' },
            clips: [
                audioClip({
                    id: 'clip-frozen-source',
                    trackId: 'track-frozen',
                    startBeat: BAKE_START_BEAT,
                    endBeat: 5,
                    audioBufferId: 'mat-a',
                }),
            ],
        });
    }
    return createTrack({
        ...shared,
        clips: [
            audioClip({
                id: 'clip-frozen-bake',
                trackId: 'track-frozen',
                startBeat: BAKE_START_BEAT,
                endBeat: BAKE_START_BEAT + BAKE_SECONDS / SECONDS_PER_BEAT,
                audioBufferId: 'bake-1',
            }),
        ],
    });
}

/**
 * Every strip both legs build, in project order.
 *
 * - **track-a** — a clip with user fades and a clip gain, plus a pre-fader send
 *   into the shaped bus.
 * - **track-b** — a looping clip whose loop length is shorter than its
 *   material, routed into the bus rather than to master.
 * - **bus-1** — panned and faded: the shaped bus.
 * - **track-c** — what the bus is routed into, which is bus→track routing, and
 *   which carries no clips of its own.
 * - **track-frozen** — see {@link frozenTrack}.
 * - **track-slipped** — the two clips whose fade endpoints fall outside their
 *   own sound: one slipped left of its material with a fade-in, one longer than
 *   its material with a fade-out. Both are ordinary edits, both used to be
 *   refused by name, and both producers now clamp them the same way
 *   (`projectNativeClipFade`) — which is only worth anything if the two
 *   renders still agree, so they are in the fixture rather than in a unit
 *   assertion alone.
 */
function fixtureTracks(leg: 'live' | 'export', extraTracks: readonly Track[] = []): Track[] {
    return [
        createTrack({
            id: 'track-a',
            name: 'Source A',
            gain: 0.7,
            pan: -18,
            sends: [{ busId: 'bus-1', level: 0.62, preFader: true }] as Track['sends'],
            clips: [
                audioClip({
                    id: 'clip-a',
                    trackId: 'track-a',
                    startBeat: 0.5,
                    endBeat: 3.5,
                    fadeInBeats: 0.25,
                    fadeOutBeats: 0.5,
                    gain: 0.7,
                    audioBufferId: 'mat-a',
                }),
            ],
        }),
        createTrack({
            id: 'track-b',
            name: 'Keeper B',
            gain: 0.55,
            pan: 10,
            outputId: 'bus-1',
            clips: [
                audioClip({
                    id: 'clip-b',
                    trackId: 'track-b',
                    startBeat: 1,
                    endBeat: 5,
                    gain: 0.35,
                    loopEnabled: true,
                    loopLength: 2,
                    audioBufferId: 'mat-b',
                }),
            ],
        }),
        createTrack({ id: 'bus-1', name: 'Shaped Bus', kind: 'bus', gain: 0.9, pan: 34, outputId: 'track-c' }),
        createTrack({ id: 'track-c', name: 'Bus Return', gain: 0.8, pan: 0 }),
        frozenTrack(leg),
        createTrack({
            id: 'track-slipped',
            name: 'Slipped',
            gain: 0.6,
            pan: 22,
            clips: [
                // Slipped left of its own material: the sound starts one beat
                // late and the fade-in the arrangement drew is over before it.
                audioClip({
                    id: 'clip-slipped',
                    trackId: 'track-slipped',
                    startBeat: 0.5,
                    endBeat: 3,
                    fadeInBeats: 0.5,
                    audioOffsetBeats: -1,
                    audioBufferId: 'mat-b',
                }),
                // Longer than its material: the sound stops early and the
                // fade-out the arrangement drew begins after it.
                audioClip({
                    id: 'clip-truncated',
                    trackId: 'track-slipped',
                    startBeat: 4,
                    endBeat: 8,
                    fadeOutBeats: 1,
                    audioBufferId: 'mat-b',
                }),
            ],
        }),
        ...extraTracks,
    ];
}

/**
 * A track carrying a loop whose expansion needs more native clip slots than a
 * strip has, and an ordinary neighbour on the same strip.
 *
 * Eight beats at a 1/256-beat loop length is 2048 iterations against the
 * strip's 1024 slots, and the engine's answer to the 1025th `schedule-clip` is
 * to refuse the whole batch. Both producers must leave the loop out and keep
 * the neighbour, and the two renders must still agree — a ceiling honoured on
 * one leg only is a bounce that is not the mix the engineer monitored.
 */
function slotOverflowTrack(): Track {
    return createTrack({
        id: 'track-overflow',
        name: 'Overflow',
        gain: 0.5,
        pan: -6,
        clips: [
            audioClip({
                id: 'clip-overflow',
                trackId: 'track-overflow',
                startBeat: 0,
                endBeat: 8,
                loopEnabled: true,
                loopLength: 1 / 256,
                audioBufferId: 'mat-b',
            }),
            audioClip({
                id: 'clip-neighbour',
                trackId: 'track-overflow',
                startBeat: 1,
                endBeat: 3,
                audioBufferId: 'mat-a',
            }),
        ],
    });
}

/**
 * A track carrying one clip at a non-unity `playbackRate` (#3068): varispeed,
 * not stretch (`crates/daw-engine/src/timeline.rs`, `ClipPlayback` doc). The
 * clip is two beats (1.0 s) at 120 bpm, reading `mat-a` (2 s) at 1.5x — 1.5 s
 * of material, leaving 0.5 s of margin. The rate must stay below 2.0 for this
 * fixture to remain a pure rate-parity case: at or past 2.0 the read reaches
 * the end of `mat-a` and the fixture would measure material exhaustion
 * instead.
 *
 * `unity` swaps the rate back to 1 with everything else held fixed, so a
 * render of this track can be compared against its own unstretched twin: a
 * native leg that silently rounded the rate to 1 would still null against the
 * live leg (both wrong the same way) but would stop differing from `unity`.
 */
function stretchedTrack(input: { unity: boolean }): Track {
    return createTrack({
        id: 'track-stretched',
        name: 'Stretched',
        gain: 0.75,
        pan: 8,
        clips: [
            audioClip({
                id: 'clip-stretched',
                trackId: 'track-stretched',
                startBeat: 0,
                endBeat: 2,
                gain: 0.9,
                audioBufferId: 'mat-a',
                stretchMode: input.unity ? 'off' : 'repitch',
                stretchRatio: 1.5,
            }),
        ],
    });
}

/** The tracks whose programme reaches the mix — the export's own vocabulary. */
function scheduledOf(tracks: readonly Track[]): Track[] {
    return tracks.filter((track) => track.kind !== 'bus');
}

// ── The two legs ──────────────────────────────────────────────────────────

async function renderExportLeg(options?: {
    extraTracks?: readonly Track[];
    /** Collects warnings instead of failing on them, for a case that expects one. */
    onWarning?: (message: string) => void;
}): Promise<Float32Array[]> {
    const transport = inProcessNativeTransport(requireNativeHost());
    const renderableTracks = fixtureTracks('export', options?.extraTracks);
    const scheduledTracks = scheduledOf(renderableTracks);
    const result = await renderOfflineWithNativeEngine({
        transport,
        sampleRate: SAMPLE_RATE,
        frameCount: FRAME_COUNT,
        durationSeconds: RENDER_SECONDS,
        masterGainValue: 1,
        defaultTempo: TEMPO,
        changes: [],
        projectPpqEndpoints,
        resolveTempoAtBeat,
        renderableTracks,
        scheduledTracks,
        scheduledTrackIds: new Set(scheduledTracks.map((track) => track.id)),
        soloGatedByTrackId: new Map(),
        vcaMultiplierByTrackId: new Map(),
        onWarning:
            options?.onWarning ??
            ((message) => {
                throw new Error(`the export leg degraded instead of rendering: ${message}`);
            }),
    });
    if (result.outcome !== 'rendered') {
        throw new Error(`the export leg declined: ${result.reason}`);
    }
    return [result.buffer.getChannelData(0), result.buffer.getChannelData(1)];
}

/**
 * The topology batch, exactly as `startNativeLiveGraphSession` builds it:
 * **parked**, because the loop region arrives with the maps a round trip later
 * and an engine already rolling would render that round trip.
 */
function projectLiveTopologyBatch(extraTracks: readonly Track[] = []): readonly AudioGraphCommand[] {
    const stripTracks = fixtureTracks('live', extraTracks);
    return projectLiveGraphTopology({
        stripTracks,
        soloGatedTrackIds: new Set(),
        vcaMultiplierByTrackId: new Map(),
        // The parity fixtures carry no externally hosted plugin, so no engine
        // attachment could change a strip in this batch.
        attachedInstanceIds: new Set(),
        transport: { playing: false, positionSeconds: 0 },
        monitor: 'shadowed',
        // Unity: the export leg this render is compared against applies the
        // project's own master level, so any other reading here would be a
        // difference in the mix rather than in the programme under test.
        masterGain: 1,
        // No fixture track monitors live input, so the carrier law leaves every
        // one of them to be judged on its chain and its routing alone.
        inputMonitoredTrackIds: new Set(),
        programme: projectLiveGraphProgramme({
            stripTracks,
            attachedInstanceIds: new Set(),
            sampleRate: SAMPLE_RATE,
            defaultTempo: TEMPO,
            changes: [],
            projectPpqEndpoints,
            resolveTempoAtBeat,
            readBuffer: (bufferId) => mocks.audioBuffers.get(bufferId) as AudioBuffer | undefined,
            compensationDelaySeconds: () => 0,
        }),
    });
}

/**
 * The whole sequence one play gesture sends, in the order it sends it.
 *
 * Three batches leave `startNativeLiveGraphSession`: the parked topology, the
 * transport maps, and the roll. The maps are not graph commands — they are
 * their own native call — so what a graph render sees is the first and the
 * third, concatenated. That is not a simplification of the production path but
 * the very shape of it: `update_graph` drains the whole ring at a block
 * boundary, so on the common fast path all three land before the first block is
 * rendered and the roll's ops sit directly behind the topology's.
 *
 * `locate` is a parameter because the difference between the two answers is
 * the defect this file caught: a roll that locates seeks to frame 0 and cancels
 * every fader, pan and send level the topology queued there.
 */
function projectLiveSessionCommands(options?: {
    rollLocates?: boolean;
    extraTracks?: readonly Track[];
}): readonly AudioGraphCommand[] {
    return [
        ...projectLiveTopologyBatch(options?.extraTracks),
        {
            kind: 'set-transport',
            playing: true,
            positionSeconds: 0,
            ...(options?.rollLocates === true ? {} : { locate: false }),
        },
    ];
}

async function renderLiveLeg(commands: readonly AudioGraphCommand[]): Promise<Float32Array[]> {
    const transport = inProcessNativeTransport(requireNativeHost());
    const material = await registerNativeTimelineSamples({ transport, commands });
    if (material.outcome !== 'registered') {
        throw new Error(`the live leg could not register its material: ${material.reason}`);
    }
    // Straight at the transport, not through `createNativeOfflineGraphBackend`:
    // that backend refuses `set-monitor-shadow` by name, and dropping the
    // command would render something other than the batch under test.
    const bytes = await transport.renderGraphOffline({
        batch: serializeAudioGraphCommandBatch({ schemaVersion: 1, commands }),
        frames: FRAME_COUNT,
        sampleRate: SAMPLE_RATE,
    });
    const { left, right } = deinterleaveStereoPcm({ bytes, frames: FRAME_COUNT });
    return [left, right];
}

function peak(channel: Float32Array): number {
    let highest = 0;
    for (const sample of channel) {
        highest = Math.max(highest, Math.abs(sample));
    }
    return highest;
}

/** The first frame at which the two renders differ, or `-1`. */
function firstDifference(left: readonly Float32Array[], right: readonly Float32Array[]): number {
    for (let channel = 0; channel < left.length; channel++) {
        const a = left[channel]!;
        const b = right[channel]!;
        for (let frame = 0; frame < a.length; frame++) {
            if (a[frame] !== b[frame]) {
                return frame;
            }
        }
    }
    return -1;
}

describe('live and export projections render one project the same way (#3068)', () => {
    beforeEach(() => {
        vi.stubGlobal('AudioBuffer', StubAudioBuffer);
        // The pool memo is process-wide; a previous file's belief about a host
        // this one never registered against would skip the registration.
        registeredNativeTimelineSampleIds.clear();
        mocks.audioBuffers = new Map<string, unknown>([
            ['mat-a', createMaterial(2, 220)],
            ['mat-b', createMaterial(1.25, 330)],
            ['bake-1', createMaterial(BAKE_SECONDS, 110)],
        ]);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /** Skip-law guard 1: the probed path is anchored to the crate that builds the artifact. */
    it('anchors the addon probe to the crate that builds the artifact', () => {
        expect(existsSync(join(NATIVE_CRATE_DIR, 'Cargo.toml'))).toBe(true);
    });

    /** Skip-law guard 2: present on disk must mean loaded, absent must mean skipped. */
    it('holds a live host exactly when the built addon exists', () => {
        expect(nativeHost !== undefined).toBe(nativeAddonPresent);
    });

    /** Skip-law guard 3: the skip is a test result, not an absence of one. */
    it.runIf(!nativeAddonPresent)(
        'skips the parity legs observably: no built addon at crates/sourdaw-native/sourdaw-native.node',
        () => {
            expect(nativeAddonPresent).toBe(false);
        }
    );

    it('carries the frozen track’s bake, and none of the clips it was baked from', () => {
        const scheduled = projectLiveSessionCommands().flatMap((command) =>
            command.kind === 'schedule-clip' && command.playback.trackId === 'track-frozen' ? [command.playback] : []
        );

        expect(scheduled).toHaveLength(1);
        expect(scheduled[0]?.source.sourceId).toBe('bake-1');
        expect(scheduled[0]?.startTime).toBe(BAKE_START_BEAT * SECONDS_PER_BEAT);
        expect(scheduled[0]?.durationSeconds).toBe(BAKE_SECONDS);
    });

    it.runIf(nativeAddonPresent)(
        'renders both projections of one project bit for bit identically',
        async () => {
            const commands = projectLiveSessionCommands();
            const [exportLeft, exportRight] = await renderExportLeg();
            const [liveLeft, liveRight] = await renderLiveLeg(commands);

            // A silent comparison proves nothing: the fixture has to be audible
            // before equality means the projections agree (ADR 0015 rule 4).
            expect(peak(exportLeft!)).toBeGreaterThan(0.01);
            expect(peak(exportRight!)).toBeGreaterThan(0.01);
            expect(firstDifference([exportLeft!, exportRight!], [liveLeft!, liveRight!])).toBe(-1);
        },
        30_000
    );

    it.runIf(nativeAddonPresent)(
        'drops a clip past the strip’s native clip slots on both legs, and still renders them alike',
        async () => {
            const extraTracks = [slotOverflowTrack()];
            const exportWarnings: string[] = [];
            const [exportLeft, exportRight] = await renderExportLeg({
                extraTracks,
                onWarning: (message) => exportWarnings.push(message),
            });
            const [liveLeft, liveRight] = await renderLiveLeg(projectLiveSessionCommands({ extraTracks }));

            expect(peak(exportLeft!)).toBeGreaterThan(0.01);
            expect(peak(exportRight!)).toBeGreaterThan(0.01);
            expect(firstDifference([exportLeft!, exportRight!], [liveLeft!, liveRight!])).toBe(-1);

            // And they agree by both leaving the loop out while both keep its
            // neighbour — not by both silencing a track the arrangement asks
            // for, which would satisfy the equality just as well.
            expect(exportWarnings).toEqual([expect.stringContaining('clip-overflow')]);
            const liveSources = projectLiveSessionCommands({ extraTracks }).flatMap((command) =>
                command.kind === 'schedule-clip' && command.playback.trackId === 'track-overflow'
                    ? [command.playback.source.sourceId]
                    : []
            );
            expect(liveSources).toEqual(['mat-a']);
        },
        30_000
    );

    it.runIf(nativeAddonPresent)(
        'renders a stretched clip identically on both legs, and differently from its unstretched twin (#3068)',
        async () => {
            const extraTracks = [stretchedTrack({ unity: false })];
            const [exportLeft, exportRight] = await renderExportLeg({ extraTracks });
            const [liveLeft, liveRight] = await renderLiveLeg(projectLiveSessionCommands({ extraTracks }));

            // Audible before equality means anything (ADR 0015 rule 4), and
            // equality between the two projections of the stretched fixture.
            expect(peak(exportLeft!)).toBeGreaterThan(0.01);
            expect(peak(exportRight!)).toBeGreaterThan(0.01);
            expect(firstDifference([exportLeft!, exportRight!], [liveLeft!, liveRight!])).toBe(-1);

            // And the rate itself is what is being heard: a native leg that
            // silently dropped `playbackRate` to unity would still null against
            // the (equally wrong) live leg above, but would stop differing from
            // its own unstretched twin.
            const unityTracks = [stretchedTrack({ unity: true })];
            const [unityLeft, unityRight] = await renderExportLeg({ extraTracks: unityTracks });
            expect(firstDifference([exportLeft!, exportRight!], [unityLeft!, unityRight!])).not.toBe(-1);
        },
        30_000
    );

    it.runIf(nativeAddonPresent)(
        'loses the mix when the topology’s transport is emitted after the strips, which is why it is emitted first',
        async () => {
            // The producer's ordering law *within* the topology batch, measured
            // rather than asserted about the command list. `set-transport` maps
            // to a `SeekFrames`, and a seek cancels every mixer write stamped at
            // or past its frame — so a transport that follows the strips drops
            // the fader, pan and send levels they just stated. Moving it back to
            // last must therefore change the render; if it does not, the
            // ordering the producer documents has stopped meaning anything.
            //
            // The roll stays where production puts it, at the end. Without it
            // nothing here renders at all: the topology batch goes out parked,
            // and a parked transport advances no playhead, so both sides would
            // be silence and the comparison would pass on nothing.
            const topology = projectLiveTopologyBatch();
            const roll = projectLiveSessionCommands().slice(topology.length);
            const ordered = await renderLiveLeg([...topology, ...roll]);
            const transportLast = await renderLiveLeg([
                ...topology.filter((command) => command.kind !== 'set-transport'),
                ...topology.filter((command) => command.kind === 'set-transport'),
                ...roll,
            ]);

            expect(firstDifference(ordered, transportLast)).not.toBe(-1);
        },
        30_000
    );

    it.runIf(nativeAddonPresent)(
        'loses the mix when the roll that follows the topology locates, which is why it does not',
        async () => {
            // The same law one batch later, and the reason the in-batch
            // ordering above is not enough. `rollNativeTransport` sends a
            // second `set-transport` after the topology and the maps; all three
            // normally drain into one `update_graph` before the first block, so
            // a roll that located would seek to frame 0 and cancel every fader,
            // pan and send level the topology queued there — the same wipe, one
            // batch later. `locate: false` is what stops it, and this is the
            // measurement that says so: the render must change when the roll is
            // allowed to locate.
            const rolled = await renderLiveLeg(projectLiveSessionCommands());
            const relocating = await renderLiveLeg(projectLiveSessionCommands({ rollLocates: true }));

            expect(firstDifference(rolled, relocating)).not.toBe(-1);
        },
        30_000
    );
});
