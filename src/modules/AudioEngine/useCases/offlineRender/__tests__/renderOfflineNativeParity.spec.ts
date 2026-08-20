/**
 * Export parity across the D3.c.2 cutover (#2225), measured at the boundary a
 * user reaches: `renderOffline` itself, once with the native engine selected
 * and once with the Web Audio renderer, on the same multi-track project. The
 * two files must null against each other — every law the cutover carries
 * across the seam (strip state, routing, sends, the fader/VCA law, ramp and
 * step automation, user fades, clip start offsets) is inside the measured
 * region, not beside it.
 *
 * ── What each leg is ───────────────────────────────────────────────────────
 *
 * Both legs run the *production* `renderOffline`, differing only in what the
 * availability probe answers:
 *
 *   - **Native leg** — the probe answers an in-process transport over the
 *     built addon (`crates/sourdaw-native/sourdaw-native.node`), so the render
 *     goes through `selectOfflineRenderEngine` → `renderOfflineWithNativeEngine`
 *     → `createNativeOfflineGraphBackend` → `render_graph_offline`, the exact
 *     production chain minus the Electron wire.
 *   - **Web leg** — the probe answers `available: false`, so the render takes
 *     the Web Audio path against the shared null-test harness
 *     (`{ automation: 'scheduled' }`, because the fixture's fades and lanes
 *     are exactly the envelopes a settled context collapses).
 *
 * `onWarning` throws in both legs: a degraded selection, a native decline, or
 * a missing buffer must fail the comparison loudly rather than quietly turn
 * it into web-versus-web.
 *
 * ── Fixture constraints (the null test's own, restated) ───────────────────
 *
 * Unstretched clips, device-free tracks, a plain bus, and every musical time
 * landing on an integral frame at 48 kHz — the envelope laws are provably
 * identical at frame boundaries, and a fractional time would measure the
 * harness's sub-frame interpolation rather than either backend. The gain
 * lane's ramp is gentle on purpose: the native ramp anchors one frame after
 * its predecessor (`convertRecordedAutomationEvents`), a deviation bounded by
 * `slope / sampleRate`, and the fixture keeps that far beneath the −90 dBFS
 * floor. `audioOffsetBeats` stays out of the fixture (#2217 is not this
 * change).
 *
 * ── Skip law ───────────────────────────────────────────────────────────────
 *
 * The parity leg needs the built addon and skips without it, under the same
 * three guards `liveOfflineNullTest.spec.ts` carries: the probed path is
 * anchored to the crate, presence must mean loaded, and the skip itself is an
 * observable test result.
 */

import { Buffer as NodeBuffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { type Track, type TrackStoreState } from '#/modules/Arrangement/stores';
import { type AutomationLane } from '#/modules/Automation/stores';
import { LEGACY_MIDI_PROBABILITY_SEED, type MidiStoreState } from '#/modules/MIDI/stores';
import { type TransportState } from '#/modules/Transport/stores';

import { NATIVE_ADDON_FILE } from '../../../../../../electron/native';
import { type NativeGraphTransport } from '../../../repositories/nativeGraph/nativeGraphTransport';
import { renderOffline } from '../../renderOffline';
import { type OfflineRenderContext } from '../resolveRenderContext';

import {
    createFixtureAudioBuffer,
    createNullTestRenderHarness,
    nullTest,
    type HarnessAudioBuffer,
    type HarnessContextOptions,
} from './nullTestRenderHarness';

const SAMPLE_RATE = 48_000;
const DURATION_BEATS = 4;
/** 120 BPM: the fixture context's one tempo law, shared by both legs. */
const SECONDS_PER_BEAT = 0.5;
const RENDER_SECONDS = DURATION_BEATS * SECONDS_PER_BEAT;
const MATERIAL_FRAMES = RENDER_SECONDS * SAMPLE_RATE;

// ── The seam mocks: what differs per leg, and nothing else ────────────────

const mocks = vi.hoisted(() => {
    const state: {
        /** The project this render resolves; assigned per test run. */
        renderContext: unknown;
        /** What `probeNativeGraphTransport` answers: the whole of the leg switch. */
        probe: { native: boolean; transport: unknown };
        /** Clip material by `audioBufferId`, replacing the IndexedDB-backed cache. */
        audioBuffers: Map<string, unknown>;
        /** The automation lanes both schedulers read. */
        lanes: unknown[];
    } = {
        renderContext: null,
        probe: { native: false, transport: null },
        audioBuffers: new Map(),
        lanes: [],
    };
    return state;
});

vi.mock('../resolveRenderContext', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../resolveRenderContext')>();
    return {
        ...actual,
        resolveRenderContext: () => mocks.renderContext as OfflineRenderContext,
    };
});

vi.mock('../../../repositories/nativeGraph/probeNativeGraphTransport', () => ({
    probeNativeGraphTransport: () =>
        Promise.resolve(
            mocks.probe.native
                ? { available: true as const, transport: mocks.probe.transport as NativeGraphTransport }
                : { available: false as const, reason: 'parity web leg', runtime: 'browser' as const }
        ),
}));

vi.mock('../../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        get: (id: string) => mocks.audioBuffers.get(id),
        has: (id: string) => mocks.audioBuffers.has(id),
        set: () => undefined,
    },
}));

vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Automation/stores')>();
    return {
        ...actual,
        automationStore: { value: { lanes: mocks.lanes } },
    };
});

// ── The addon, loaded exactly as the live/offline null test loads it ──────

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
    '..', // offlineRender
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
 * cannot load fails the file here, before any `runIf` can turn that into a
 * skip. The constructor opens no audio device — the live engine starts lazily
 * on first `apply_graph_commands`, which the offline path never issues.
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
        throw new Error('native leg ran without the built addon — the skip law above is broken');
    }
    return nativeHost;
}

/**
 * The in-process transport: the same commands the desktop transport carries,
 * minus the wire. `applyGraphCommands` throws because an export must never
 * touch the live engine.
 */
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
            throw new Error('the export parity spec never touches the live engine (apply_graph_commands)');
        },
    };
}

// ── Globals the two legs construct through ────────────────────────────────

/**
 * What `renderOfflineWithNativeEngine` builds its answer in. Structural,
 * because jsdom has no `AudioBuffer`; `instanceof` on the render result is the
 * proof the *native* path produced the file (the web leg answers the
 * harness's own rendered buffer, which is not one of these).
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

// ── Fixture: the project both legs render ─────────────────────────────────

// Field-identical replica of Arrangement's TrackDummy fixture — foreign test
// fixtures have no compliant cross-module path (models are not re-exported).
const TrackDummy = {
    create: (overrides?: Partial<Track>): Track => ({
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
        automationMode: 'read',
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
    }),
};

const emptyMidi: NonNullable<MidiStoreState> = {
    probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
    notesByClipId: {},
    ccByClipId: {},
    pitchBendByClipId: {},
};

function audioClip(
    overrides: Partial<Track['clips'][number]> & { id: string; trackId: string }
): Track['clips'][number] {
    return {
        name: overrides.id,
        startBeat: 0,
        endBeat: 1,
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

function lane(input: {
    id: string;
    trackId: string;
    parameterId: string;
    minValue: number;
    maxValue: number;
    points: { beat: number; value: number; curve: 'linear' | 'step'; tension: number }[];
}): AutomationLane {
    return {
        id: input.id,
        trackId: input.trackId,
        parameterId: input.parameterId,
        parameterName: input.parameterId,
        points: input.points,
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: input.minValue,
        maxValue: input.maxValue,
    };
}

/**
 * The project. Every musical time is an integral frame at 48 kHz / 120 BPM:
 *
 * - **track-a** — clip at beat 0.5–3.5 with user fades (0.25 in / 0.5 out) and
 *   clip gain 0.7; a *linear-ramp* gain lane 0.7 → 0.5 over beats 0–3 whose
 *   initial value equals the track fader (so neither leg depends on write
 *   order at frame 0); a pre-fader send to bus-1 with a *step* lane.
 * - **track-b** — clip at beat 1–4 (a start offset, no user fades, micro fades
 *   only) with clip gain 0.35; a *step* pan lane whose first point equals the
 *   track's own pan (10 project = 0.2 node), stepping to −0.4 at beat 2.
 * - **bus-1** — plain (pan 0, unmuted): the one bus shape the native strip
 *   holds, receiving track-a's send.
 */
function fixtureTracks(): Track[] {
    const trackA = TrackDummy.create({
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
    });
    const trackB = TrackDummy.create({
        id: 'track-b',
        name: 'Keeper B',
        gain: 0.55,
        pan: 10,
        clips: [
            audioClip({
                id: 'clip-b',
                trackId: 'track-b',
                startBeat: 1,
                endBeat: 4,
                gain: 0.35,
                audioBufferId: 'mat-b',
            }),
        ],
    });
    const bus = TrackDummy.create({ id: 'bus-1', name: 'Bus 1', kind: 'bus', gain: 0.9, pan: 0 });
    return [trackA, trackB, bus];
}

function fixtureLanes(): AutomationLane[] {
    return [
        lane({
            id: 'lane-gain-a',
            trackId: 'track-a',
            parameterId: 'gain',
            minValue: 0,
            maxValue: 1,
            points: [
                { beat: 0, value: 0.7, curve: 'linear', tension: 0 },
                { beat: 3, value: 0.5, curve: 'linear', tension: 0 },
            ],
        }),
        lane({
            id: 'lane-send-a',
            trackId: 'track-a',
            parameterId: 'send:bus-1',
            minValue: 0,
            maxValue: 1,
            points: [
                { beat: 1, value: 0.3, curve: 'step', tension: 0 },
                { beat: 2.5, value: 0.55, curve: 'step', tension: 0 },
            ],
        }),
        lane({
            id: 'lane-pan-b',
            trackId: 'track-b',
            parameterId: 'pan',
            minValue: -1,
            maxValue: 1,
            points: [
                { beat: 0, value: 0.2, curve: 'step', tension: 0 },
                { beat: 2, value: -0.4, curve: 'step', tension: 0 },
            ],
        }),
    ];
}

function fixtureRenderContext(): OfflineRenderContext {
    return {
        tracks: { tracks: fixtureTracks() } as unknown as TrackStoreState,
        midi: emptyMidi,
        transport: { masterGain: 80 } as TransportState,
        defaultTempo: 120,
        changes: [],
        startBeat: 0,
        durationSeconds: RENDER_SECONDS,
        tailSeconds: 0,
        projectMidiEvents: ({ events }) => events,
        selectMidiEventProbability: () => true,
        projectChordPitch: ({ pitch }) => pitch,
        projectPpqEndpoints: ({ startPpq, endPpq, sampleRate }) => {
            const startSeconds = startPpq * SECONDS_PER_BEAT;
            const endSeconds = endPpq * SECONDS_PER_BEAT;
            return {
                startSamples: startSeconds * sampleRate,
                endSamples: endSeconds * sampleRate,
                durationSamples: (endSeconds - startSeconds) * sampleRate,
                startSeconds,
                endSeconds,
                durationSeconds: endSeconds - startSeconds,
            };
        },
        processYeastMidi: null,
        evaluateAutomationValue: null,
    };
}

/** Distinct material per clip, so a cross-wired track cannot null by luck. */
function fixtureMaterial(): { matA: HarnessAudioBuffer; matB: HarnessAudioBuffer } {
    const matA = createFixtureAudioBuffer({ frames: MATERIAL_FRAMES, sampleRate: SAMPLE_RATE });
    const matB = createFixtureAudioBuffer({ frames: MATERIAL_FRAMES, sampleRate: SAMPLE_RATE });
    for (let channel = 0; channel < matB.numberOfChannels; channel++) {
        const data = matB.getChannelData(channel);
        const scale = channel === 0 ? -0.8 : 0.65;
        for (let frame = 0; frame < data.length; frame++) {
            data[frame] = data[frame]! * scale;
        }
    }
    return { matA, matB };
}

// ── Running one leg ────────────────────────────────────────────────────────

type LegMeasurement = {
    buffer: AudioBuffer;
    durationMs: number;
    /** `process.memoryUsage().rss` right after the render resolves. */
    rssBytes: number;
};

async function runLeg(leg: 'native' | 'web'): Promise<LegMeasurement> {
    mocks.probe.native = leg === 'native';
    const startedAt = Date.now();
    const buffer = await renderOffline({
        durationBeats: DURATION_BEATS,
        sampleRate: SAMPLE_RATE,
        onWarning: (message) => {
            throw new Error(`${leg} leg degraded instead of rendering: ${message}`);
        },
    });
    return { buffer, durationMs: Date.now() - startedAt, rssBytes: process.memoryUsage().rss };
}

describe('renderOffline — native/web export parity (#2225)', () => {
    beforeEach(() => {
        const harness = createNullTestRenderHarness();
        // `renderOffline` constructs the three-argument browser form; the
        // harness needs `{ automation: 'scheduled' }` or every fade and lane
        // in the fixture collapses to its settled value.
        class ScheduledOfflineAudioContext {
            constructor(numberOfChannels: number, length: number, sampleRate: number) {
                const options: HarnessContextOptions = { automation: 'scheduled' };
                return new harness.OfflineAudioContext(numberOfChannels, length, sampleRate, options);
            }
        }
        vi.stubGlobal('OfflineAudioContext', ScheduledOfflineAudioContext);
        vi.stubGlobal('AudioBuffer', StubAudioBuffer);

        const { matA, matB } = fixtureMaterial();
        mocks.audioBuffers.clear();
        mocks.audioBuffers.set('mat-a', matA);
        mocks.audioBuffers.set('mat-b', matB);
        mocks.lanes.length = 0;
        mocks.lanes.push(...fixtureLanes());
        mocks.renderContext = fixtureRenderContext();
        mocks.probe.native = false;
        mocks.probe.transport = null;
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
        'skips the parity leg observably: no built addon at crates/sourdaw-native/sourdaw-native.node',
        () => {
            expect(nativeAddonPresent).toBe(false);
        }
    );

    it.runIf(nativeAddonPresent)(
        'renders the same file through the native engine and through Web Audio',
        async () => {
            mocks.probe.transport = inProcessNativeTransport(requireNativeHost());

            const native = await runLeg('native');
            // The discriminating half of the leg switch: only the native path
            // constructs its answer in the stubbed `AudioBuffer`; a silent
            // fallback to Web Audio would answer the harness's buffer and
            // fail here rather than null web-against-web.
            expect(native.buffer).toBeInstanceOf(StubAudioBuffer);

            const web = await runLeg('web');
            expect(web.buffer).not.toBeInstanceOf(StubAudioBuffer);

            const result = nullTest({ a: web.buffer, b: native.buffer });
            process.stdout.write(
                `[parity] web leg: ${String(web.durationMs)} ms, rss ${String(web.rssBytes)} bytes\n` +
                    `[parity] native leg: ${String(native.durationMs)} ms, rss ${String(native.rssBytes)} bytes\n` +
                    `[parity] null: residual ${result.residualPeakDbfs.toFixed(2)} dBFS, ` +
                    `signal ${result.signalPeakDbfs.toFixed(2)} dBFS, worst frame ${String(result.worstFrame)}\n`
            );

            // The presence pin (ADR 0015 rule 4): a null against silence is not a null.
            expect(result.signalPeakDbfs).toBeGreaterThan(-30);
            expect(result.residualPeakDbfs).toBeLessThanOrEqual(-90);
        },
        30_000
    );
});
