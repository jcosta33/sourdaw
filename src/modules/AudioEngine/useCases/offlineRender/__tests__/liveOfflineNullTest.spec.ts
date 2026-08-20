/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Live / offline null test — SPEC-render-parity-instrumentation AC-1
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  BUDGET: residual peak ≤ −90 dBFS.
 *  Anything above −60 dBFS is a defect, not tolerance.
 *
 * ── Why those two numbers ─────────────────────────────────────────────────
 *
 * −90 dBFS is round-off. Both legs run the same arithmetic on `Float32Array`
 * storage, so a residual can only come from operations being *ordered*
 * differently — a gain folded before a clamp instead of after, a summing node
 * inserted on one side. f32 carries ~24 significant bits, so accumulated
 * round-off over a chain of this depth stays comfortably under −120 dBFS; −90
 * is 30 dB of headroom over that and still 3 dB below the noise floor of a
 * 16-bit master. A residual above it is a level, a law or a topology that
 * differs, not arithmetic.
 *
 * −60 dBFS is audible. It is roughly the noise floor of a cassette, and a
 * residual at that level in a bounce is a difference a listener can hear on a
 * quiet passage. There is no device for which "the export differs from playback
 * by an audible amount" is acceptable, so the budget is never widened to admit
 * one. **If a device cannot meet this, that is the finding.** Report it; do not
 * raise the number, do not add a per-device tolerance table, and do not narrow
 * the measured region to exclude where it fails. Every one of those turns an
 * instrument into decoration, which is what ADR 0015 exists to stop.
 *
 * ── What is measured ──────────────────────────────────────────────────────
 *
 * One fixture signal, two production graph builders, subtracted:
 *
 *   live     `new TrackNode(...)` — the class `createWebAudioEngine` builds a
 *            channel strip with — plus the real live writers a user's mixer
 *            moves reach: `addDevice`, `updateParam`, `updateBypass`,
 *            `setGain`, `setPan`, `setMute`.
 *   offline  `createOfflineTrackStrip(...)` — what an export builds, through
 *            the real `buildDeviceChain` and the real device registry.
 *
 * Neither is stubbed. That is the whole point of the file: the existing
 * live/offline parity specs stub one side and compare call shapes, so
 * `toasterLiveOfflineParity.spec.ts` never constructs a live strip at all and a
 * projection that is wrong but self-consistent passes it. This subtracts audio.
 *
 * It does **not** replace that spec, and AC-1's word "replaces" should be read
 * as an ambition rather than a description. `toasterLiveOfflineParity.spec.ts`
 * still exists and still stubs `getTrackStrip`, and deleting it now would remove
 * the only coverage Toaster's projection has — for the reason in the scope note
 * below, this file cannot yet take it over.
 *
 * Web Audio itself is modelled — see `nullTestRenderHarness.ts` for exactly
 * what that model does and does not cover, and why the model cancels out of a
 * subtraction where both legs run through it.
 *
 * ── How much of "two independent implementations" this really is ──────────
 *
 * Two different answers, and conflating them overstates the result:
 *
 * **The strip is two implementations.** `TrackNode`'s constructor and
 * `createOfflineTrackStrip` are separately-written node graphs with different
 * node counts, a different output stage and independently-written level, pan,
 * mute and clamp laws. A null there is a real cross-check.
 *
 * **The device chain is largely one implementation.** For every device fixtured
 * here, `createBuiltinDeviceNode` is a one-line delegate to
 * `createOfflineDeviceNode` — the same function `createWebAudioDevice` calls —
 * and `createFilter`, `createGainDevice`, `createEq` and `createDistortion` all
 * ignore the `device` argument that distinguishes the two call sites. What
 * genuinely differs is (a) chain topology, which `rebuildChain` and
 * `buildDeviceChain` build independently, and (b) whether `applyParams` is
 * called on the offline side at all. The batch-versus-per-parameter difference
 * noted at `renderLive` can only produce a divergence for an applier with
 * cross-parameter coupling, and none of the four has any. Do not cite a green
 * device-chain null as evidence that two device builders agree; cite it as
 * evidence that the topology agrees and the parameters arrive.
 *
 * ── What this instrument does not cover ───────────────────────────────────
 *
 * Written down because a green file this size invites over-trust. None of the
 * following is measured here, and a claim about any of it needs another
 * instrument:
 *
 *   - **Four of the nineteen builtin device types** are fixtured — gain, filter,
 *     EQ and distortion, the ones whose nodes this harness models. The other
 *     fifteen need a compressor, delay line, convolver or oscillator first, and
 *     **no wasm device is fixtured at all** (Fermenter, Toaster, Levain, Grand
 *     Boule, Grinder, Gluten, Proof, Bacteria, Knead, Crumbs). The devices whose
 *     live/offline divergence motivated this phase are all in that second group.
 *   - **The path an automated parameter takes between two writes.** The fader
 *     fixtures at the foot of this file measure where a `ramp-to`, `smoothed`
 *     or `hold` sequence comes to *rest*, which is what a bounce of a settled
 *     mixer owes. A lane gliding across a render is a different property, with
 *     its own specs (`automationScheduling`, `offlineVcaGainParity`) — the one
 *     exception is a clip's fade envelope, which is walked because a fade is a
 *     shape rather than a resting value.
 *   - **VCA multipliers, `honorMuted` and `contributesAudio`.** Every fixture
 *     here is built with the mixdown's settings.
 *   - **Live mute parity.** `renderLive` calls `setMute`, but every
 *     live/offline fixture keeps `muted: false` — the live gate never closes,
 *     so a live mute law gating the wrong node would pass this file. The one
 *     muted fixture runs contract-vs-reference, where both legs bake mute
 *     through the same `createOfflineTrackStrip` code and cannot see it
 *     either. Pinning it needs a keeper strip on the live leg first.
 *   - **The master chain and adjustment layers.** The most a fixture routes is
 *     three strips and a send into one master gain.
 *   - **Note timing, loop iterations, comping and render tails.** One audio
 *     clip with its two user fades is fixtured; nothing MIDI is.
 *     `offlineNoteScheduleTiming.spec.ts` covers the note path.
 *   - **Stretch beyond one constant rate.** A half-speed clip is fixtured, so
 *     the seam's destination-vs-source duration law is measured; a rate that
 *     *changes* across a render is not, and neither is a stretched clip whose
 *     material runs out under it.
 *
 * ── Fixture constraints ───────────────────────────────────────────────────
 *
 * **No Yeast.** Its generators phase-lock to the first block they see, so two
 * renders of one project differ for reasons unrelated to anything under test.
 * A null test that is nondeterministic for a known unrelated reason is worse
 * than no null test. The one-clock work that fixes it is a later phase; until
 * it lands, Yeast stays out of every fixture here.
 *
 * **Deterministic devices only.** The fixture chain is builtin Web Audio
 * devices whose output is a pure function of their parameters. Devices with an
 * internal LFO, a delay line or a WASM engine are not fixtured here — not
 * because they are exempt, but because the harness models no node for them and
 * refuses to build one rather than silently rendering them as pass-throughs.
 * Extending this to them means extending the harness first.
 *
 * ── The backend axis ──────────────────────────────────────────────────────
 *
 * The two legs above vary *which construction path* built the graph, with one
 * renderer underneath. The third leg varies the renderer: it nulls backend A
 * against backend B over the same fixture table, so that when the Rust engine
 * becomes the desktop backend the question "does the native render sound like
 * the web render?" is asked by an instrument that already exists and is already
 * known to be sharp, rather than by one written after the fact to fit whatever
 * the new backend happens to produce.
 *
 * Two occupants sit in the backend B slot, and they answer different questions.
 *
 * A **stand-in** reaches the same renderer through the seam, and its teeth are
 * the perturbed half: it is handed divergences of the exact magnitudes the
 * sharpness probes below already prove visible, and the leg is required to go
 * **red**. A comparison harness that cannot fail is decoration. Both states are
 * asserted — perturbed reds, and the same fixture through an agreeing stand-in
 * nulls.
 *
 * The **contract-backed backend** is the offline renderer behind
 * `AudioGraphBackend`, the seam the native engine will implement. It is not an
 * independent renderer either — the contract's implementation is the export's
 * own code, moved rather than rewritten — so read its green half as being about
 * the *translation*: project truth in, commands, the same graph out. Every law
 * the contract restates is a law that could be restated wrongly, and the
 * perturbed half is aimed at it too.
 *
 * Neither occupant makes a cross-backend claim, and neither is asked to. The
 * seam is shown to carry two genuinely different implementations by driving it
 * with the live and offline builders — the pair leg one already cross-checks —
 * which is what makes a native backend a drop-in for the same slot.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AudioGraphCommand, type AudioGraphParameterWrite } from '../../../models/AudioGraphBackend';
import { type Device } from '../../../models/TrackViewTypes';

import {
    createFixtureAudioBuffer,
    createFixtureSignal,
    createNullTestRenderHarness,
    nullTest,
    type HarnessAudioBuffer,
    type HarnessContextOptions,
    type HarnessRenderContext,
    type NullTestResult,
    type RenderedBuffer,
} from './nullTestRenderHarness';

const SAMPLE_RATE = 48_000;
const RENDER_FRAMES = 24_000;

/** SPEC-render-parity-instrumentation AC-1. Do not raise. */
const RESIDUAL_BUDGET_DBFS = -90;
/** Above this a residual is audible. AC-1 calls it a defect, not tolerance. */
const RESIDUAL_DEFECT_DBFS = -60;
/** The one track every leg builds. */
const FIXTURE_TRACK_ID = 'track-1';

const harness = createNullTestRenderHarness();
harness.installWorkletGlobals({ sampleRate: SAMPLE_RATE });
vi.stubGlobal('AudioWorkletNode', harness.AudioWorkletNode);
vi.stubGlobal('OfflineAudioContext', harness.OfflineAudioContext);

// The live strip puts a real metering worklet in the signal path when
// SharedArrayBuffer is available, which it is under Node. Registering the real
// processor keeps the live topology faithful instead of testing a shape the
// product never builds.
await import('../../../services/meteringProcessor');

const { TrackNode } = await import('../../../engine/TrackNode');
const { createDeviceReadinessDiagnostics } = await import('../../../engine/deviceReadinessDiagnostics');
const { createOfflineBusStrip } = await import('../createOfflineBusStrip');
const { createOfflineTrackStrip } = await import('../createOfflineTrackStrip');
const { createWebAudioOfflineBackend } = await import('../createWebAudioOfflineBackend');
const { scheduleOfflineClipSource } = await import('../scheduleOfflineClipSource');
const { MICRO_FADE_SECONDS } = await import('../constants');

type TrackFixture = {
    name: string;
    gain: number;
    pan: number;
    muted: boolean;
    devices: Device[];
};

function device(input: {
    id: string;
    type: string;
    parameterValues: Record<string, number>;
    bypassed?: boolean;
}): Device {
    return {
        id: input.id,
        name: input.id,
        type: input.type,
        bypassed: input.bypassed ?? false,
        parameterValues: input.parameterValues,
    };
}

function newContext(options?: HarnessContextOptions): HarnessRenderContext {
    return new harness.OfflineAudioContext(2, RENDER_FRAMES, SAMPLE_RATE, options);
}

/**
 * Bridge a production node type onto the harness's.
 *
 * The strips are typed `GainNode`/`StereoPannerNode` because production builds
 * them, and the harness's nodes are structurally different objects that answer
 * the same calls. Named once so the casts read as the one bridge they are
 * rather than as a claim about the types.
 */
type ConnectableNode = { connect: (to: unknown) => unknown };

function connectNodes(from: unknown, to: unknown): void {
    (from as ConnectableNode).connect(to);
}

/** A master gain wired to the destination, as every leg builds one. */
function newMaster(context: HarnessRenderContext): unknown {
    const master = context.createGain() as { gain: { value: number }; connect: (to: unknown) => unknown };
    master.gain.value = 1;
    master.connect(context.destination);
    return master;
}

/**
 * The refusal every leg owes the fixture set.
 *
 * `buildDeviceChain` treats a device it cannot construct as a degrade — it warns
 * and continues. Correct for an export, wrong for a fixture, because the null is
 * then taken between two graphs that both lack the device under test.
 */
function throwOnDegradedDevice(leg: string): (message: string) => void {
    return (message: string) => {
        throw new Error(`${leg} degraded a fixtured device instead of building it: ${message}`);
    };
}

type RenderOptions = {
    /** Multiplies the fixture signal. Used only by the homogeneity guard. */
    signalScale?: number;
};

/** One leg's output, plus what it actually built. */
type LegRender = {
    buffer: RenderedBuffer;
    /** Device ids present in the rendered graph, in graph order. */
    builtDeviceIds: string[];
};

function fixtureSignal(scale: number): { left: Float32Array; right: Float32Array } {
    const signal = createFixtureSignal({ frames: RENDER_FRAMES, sampleRate: SAMPLE_RATE });
    if (scale === 1) {
        return signal;
    }
    return {
        left: signal.left.map((sample) => sample * scale),
        right: signal.right.map((sample) => sample * scale),
    };
}

/**
 * Multiply a render by a constant, for the homogeneity guard.
 *
 * The scale is always a power of two, so the multiply is exact in binary
 * floating point and introduces no rounding of its own. A linear chain then has
 * to null to `-Infinity` rather than merely to somewhere under the budget,
 * which is what makes the linear control worth having.
 */
function scaleBuffer(buffer: RenderedBuffer, scale: number): RenderedBuffer {
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        channels.push(buffer.getChannelData(channel).map((sample) => sample * scale));
    }
    return {
        sampleRate: buffer.sampleRate,
        length: buffer.length,
        numberOfChannels: buffer.numberOfChannels,
        getChannelData: (channel: number) => channels[channel] ?? channels[0]!,
    };
}

/**
 * Refuse a leg that quietly rendered without a device the fixture named.
 *
 * This is the presence pin that matters, and it is not the same as pinning the
 * signal. A strip always carries the fixture at roughly −11 dBFS whether or not
 * any device built, so a signal-level pin passes happily on a fixture whose
 * `type` is a typo: the device is absent from *both* graphs, the two silences
 * of it agree, and the null comes back `-Infinity`. Live drops an unrecognised
 * type by returning bare from `addDevice` (`TrackNode.ts:663-665`) and offline
 * drops it through `buildDeviceChain`'s catch-and-`continue`, so nothing else
 * in either runtime will complain.
 */
function assertDevicesBuilt(input: { leg: string; expected: string[]; built: string[] }): void {
    const missing = input.expected.filter((id) => !input.built.includes(id));
    if (missing.length > 0) {
        throw new Error(
            `${input.leg} leg rendered without fixtured device(s) [${missing.join(', ')}]; ` +
                `built [${input.built.join(', ') || 'none'}]. A null taken against this proves nothing.`
        );
    }
}

/**
 * The live leg: a real `TrackNode`, driven by the real live writers.
 *
 * The device parameters go in one at a time through `updateParam`, because that
 * is how they arrive live — `WebAudioEngine.updateDeviceParam` forwards a single
 * `(deviceId, paramId, value)` per store change. The offline leg hands
 * `applyParams` the whole `parameterValues` record at construction. Those are
 * two different call patterns into the same appliers; see the scope note in the
 * file header for how little that can diverge by for the fixtured devices.
 */
async function renderLive(fixture: TrackFixture, options: RenderOptions = {}): Promise<LegRender> {
    const context = newContext();
    const master = context.createGain() as { gain: { value: number }; connect: (to: unknown) => unknown };
    master.gain.value = 1;
    master.connect(context.destination);

    const trackNode = new TrackNode(FIXTURE_TRACK_ID, {
        context: context as unknown as AudioContext,
        masterGainNode: master as unknown as GainNode,
        getBusGainNode: () => undefined,
        getTrackGainNode: () => undefined,
        getSendsForTrack: () => [],
        pendingDevicePromises: new Set<Promise<unknown>>(),
        readinessDiagnostics: createDeviceReadinessDiagnostics(),
    });

    for (const entry of fixture.devices) {
        trackNode.addDevice(entry.id, entry.type);
        for (const [parameterId, value] of Object.entries(entry.parameterValues)) {
            trackNode.updateParam(entry.id, parameterId, value);
        }
        if (entry.bypassed) {
            trackNode.updateBypass(entry.id, true);
        }
    }
    trackNode.setGain(fixture.gain);
    trackNode.setPan(fixture.pan);
    trackNode.setMute(fixture.muted);

    // `updateBypass` coalesces its rebuild into a microtask (TrackNode §88.3);
    // rendering before it runs would measure the pre-bypass graph.
    await Promise.resolve();
    await Promise.resolve();

    const source = context.createSignalSource(fixtureSignal(options.signalScale ?? 1));
    source.connect(trackNode.strip.gainNode);
    const buffer = await context.startRendering();
    const builtDeviceIds = trackNode.strip.deviceNodes.map((node) => node.deviceId);
    assertDevicesBuilt({ leg: 'live', expected: fixture.devices.map((entry) => entry.id), built: builtDeviceIds });
    return { buffer, builtDeviceIds };
}

/**
 * The offline leg: what an export builds, through the production strip builder.
 *
 * The throwing `onWarning` is load-bearing. `buildDeviceChain` treats a device
 * it cannot construct as a degrade — it warns and `continue`s, dropping the
 * device and letting the render succeed. That is the right behaviour for an
 * export and the wrong behaviour for a fixture, because the resulting null is
 * taken between two graphs that both lack the device under test. The harness's
 * refusal to model a node reaches the caller on the live leg by throwing; on
 * this leg it arrives here instead, and has to be turned back into a failure.
 */
async function renderOffline(fixture: TrackFixture, options: RenderOptions = {}): Promise<LegRender> {
    const context = newContext();
    const master = context.createGain() as { gain: { value: number }; connect: (to: unknown) => unknown };
    master.gain.value = 1;
    master.connect(context.destination);

    const strip = await createOfflineTrackStrip(
        context as unknown as OfflineAudioContext,
        {
            id: FIXTURE_TRACK_ID,
            name: fixture.name,
            gain: fixture.gain,
            muted: fixture.muted,
            pan: fixture.pan,
            devices: fixture.devices,
        },
        {
            // Third argument, not the track — `onWarning` lives in the options.
            // Passing it on the track object type-checks (excess properties on a
            // fresh object literal are only checked against the declared type,
            // and `name`/`gain`/… match) and is silently ignored.
            onWarning: (message: string) => {
                throw new Error(`offline chain degraded a fixtured device instead of building it: ${message}`);
            },
        }
    );
    (strip.outputNode as unknown as { connect: (to: unknown) => unknown }).connect(master);

    const source = context.createSignalSource(fixtureSignal(options.signalScale ?? 1));
    source.connect(strip.inputNode);
    const buffer = await context.startRendering();
    const builtDeviceIds = strip.deviceEntries.map((entry) => entry.deviceId);
    // Bypassed devices are filtered out by `buildDeviceChain` before construction,
    // which is correct and is asserted by the bypass fixture rather than here.
    assertDevicesBuilt({
        leg: 'offline',
        expected: fixture.devices.filter((entry) => !entry.bypassed).map((entry) => entry.id),
        built: builtDeviceIds,
    });
    return { buffer, builtDeviceIds };
}

async function nullTestFixture(fixture: TrackFixture): Promise<NullTestResult> {
    const live = await renderLive(fixture);
    const offline = await renderOffline(fixture);
    return nullTest({ a: live.buffer, b: offline.buffer });
}

/**
 * Every assertion in this file goes through here so no fixture can pass by
 * being silent on both sides, and so a failure reports the number rather than
 * just the verdict.
 */
function expectNull(result: NullTestResult): void {
    expect(result.signalPeakDbfs).toBeGreaterThan(-40);
    expect(
        result.residualPeakDbfs,
        `residual ${result.residualPeakDbfs.toFixed(2)} dBFS at frame ${result.worstFrame}, ` +
            `signal ${result.signalPeakDbfs.toFixed(2)} dBFS`
    ).toBeLessThanOrEqual(RESIDUAL_BUDGET_DBFS);
}

const BASE_TRACK: TrackFixture = { name: 'Fixture', gain: 0.8, pan: 0, muted: false, devices: [] };

/**
 * The fixture device population, in one place.
 *
 * Every device any test in this file renders comes from here, and the coverage
 * guards below enumerate *this table* rather than a list written beside them.
 * That is ADR 0015 rule 2 turned on the harness's own coverage check: a census
 * whose population and whose expectation come from two different places tests
 * nothing, and a list of four device names sitting next to six `it`s that build
 * their own fixtures inline is exactly that. Adding an entry here forces it
 * through the audibility and homogeneity guards; adding a device anywhere else
 * is what the guards are meant to make impossible.
 *
 * Parameter values are deliberately away from every factory default, so a chain
 * built from a constructor's own state instead of the project's cannot null.
 */
const FIXTURE_DEVICES = {
    gain: device({ id: 'fx-gain', type: 'builtin-gain', parameterValues: { 'gain-level': -4.5 } }),
    gainTrim: device({ id: 'fx-gain-trim', type: 'builtin-gain', parameterValues: { 'gain-level': -2 } }),
    filter: device({
        id: 'fx-filter',
        type: 'builtin-filter',
        // Not the factory's lowpass / 1000 Hz / Q 1.
        parameterValues: { 'filter-cutoff': 2400, 'filter-resonance': 6.5, 'filter-type': 1 },
    }),
    eq: device({
        id: 'fx-eq',
        type: 'builtin-eq',
        parameterValues: {
            'eq-low-gain': 4.5,
            'eq-low-freq': 120,
            'eq-low-q': 0.8,
            'eq-mid-gain': -3,
            'eq-mid-freq': 900,
            'eq-mid-q': 2.2,
            'eq-high-gain': 2,
            'eq-high-freq': 7200,
            'eq-high-q': 0.7,
        },
    }),
    distortion: device({
        id: 'fx-distortion',
        type: 'builtin-distortion',
        parameterValues: { 'dist-drive': 55, 'dist-tone': 2600, 'dist-output': -2.5, 'dist-mix': 0.65 },
    }),
} satisfies Record<string, Device>;

const FIXTURE_DEVICE_ENTRIES = Object.entries(FIXTURE_DEVICES);

/**
 * The strip and chain configurations rendered by more than one leg.
 *
 * These were literals inside the tests below until the backend leg started
 * sweeping the same population, and two hand-maintained copies of a fixture is
 * the same defect the `FIXTURE_DEVICES` comment above describes: they drift on
 * the first edit, nothing goes red, and the backend leg's "same population, one
 * axis changed" attribution quietly stops being true. One definition, two
 * consumers.
 *
 * The extraction is mechanical and nothing else moved. Every assertion, every
 * budget and every comment in the legs below is where it was; only the fixture
 * expression each test passes changed, from a literal to the name of that same
 * literal. Nothing mutates these objects — the perturbed backend leg copies
 * before it changes anything — so sharing them cannot couple two legs' results.
 */
const SHARED_FIXTURES = {
    unityStrip: { ...BASE_TRACK, gain: 1 },
    faderOffUnity: { ...BASE_TRACK, gain: 0.37 },
    faderAboveCeiling: { ...BASE_TRACK, gain: 1.8 },
    pannedStrip: { ...BASE_TRACK, pan: -31 },
    chainInProjectOrder: {
        ...BASE_TRACK,
        gain: 0.62,
        pan: 18,
        devices: [FIXTURE_DEVICES.gain, FIXTURE_DEVICES.filter, FIXTURE_DEVICES.distortion, FIXTURE_DEVICES.eq],
    },
    chainWithBypassedDevice: {
        ...BASE_TRACK,
        devices: [FIXTURE_DEVICES.gain, { ...FIXTURE_DEVICES.filter, bypassed: true }, FIXTURE_DEVICES.gainTrim],
    },
} satisfies Record<string, TrackFixture>;

describe('live/offline null test — the strip itself', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('nulls a bare strip at unity', async () => {
        expectNull(await nullTestFixture(SHARED_FIXTURES.unityStrip));
    });

    it('nulls a strip whose fader is not at unity', async () => {
        expectNull(await nullTestFixture(SHARED_FIXTURES.faderOffUnity));
    });

    it('nulls a strip whose stored gain sits above the fader ceiling', async () => {
        // FX-7: live clamps in `TrackNode.setGain`, offline in
        // `createOfflineTrackStrip`. A project carrying gain > 1 — importers and
        // older files do — is where the two laws can part.
        expectNull(await nullTestFixture(SHARED_FIXTURES.faderAboveCeiling));
    });

    it('nulls a panned strip', async () => {
        expectNull(await nullTestFixture(SHARED_FIXTURES.pannedStrip));
    });
});

describe('live/offline null test — deterministic device chains', () => {
    it.each(FIXTURE_DEVICE_ENTRIES)('nulls the %s device on its own', async (_name, entry) => {
        expectNull(await nullTestFixture({ ...BASE_TRACK, devices: [entry] }));
    });

    it('nulls a multi-device chain in project order', async () => {
        // Ordering is the part of the device chain that really is two
        // implementations: `rebuildChain` walks `prevs` and `buildDeviceChain`
        // walks `prev`, and they were written separately.
        expectNull(await nullTestFixture(SHARED_FIXTURES.chainInProjectOrder));
    });

    it('nulls a chain with a bypassed device in the middle', async () => {
        // The two runtimes disagree about *representation* here and must still
        // agree about audio: live keeps the bypassed device in `deviceNodes` and
        // skips it while rewiring, offline filters it out before construction.
        expectNull(await nullTestFixture(SHARED_FIXTURES.chainWithBypassedDevice));
    });
});

describe('live/offline null test — the instrument can fail', () => {
    /**
     * ADR 0015 rule 1: a guard ships with the mutation that reds it, and rule 2
     * wants that mutation committed rather than run once.
     *
     * The break is chosen to be *representative*, not convenient. A hand-injected
     * DC offset would prove only that subtraction works. What is injected here is
     * the symptom this whole phase exists to find: **the offline path rendering a
     * device from its constructor's own defaults instead of from the project's
     * stored configuration** — the symptom the Toaster export had when it
     * rendered `ToasterEngine::new`'s kit rather than the user's pads, and the
     * Levain export had when it built an engine with no sample zones.
     *
     * **The seam is not the same seam, and the difference matters.** The
     * Toaster/Levain defects live at the wasm registry split — live through
     * `engine/wasmDeviceRegistry.ts`, offline through
     * `nativeDspDeviceFactories.ts`, the "two registries, not one builder with a
     * flag" `buildDeviceChain.ts:227` names. On the builtin path there is no
     * second registry, so that bug class structurally cannot occur where this
     * break is injected. What is demonstrated is that the instrument detects the
     * symptom at realistic magnitude, not that it is watching the seam the
     * original defects came through. Watching that seam needs wasm devices in the
     * fixture set, which needs a harness that can run them.
     *
     * The mutation: `WebAudioDeviceStrategy.createWebAudioDevice` — reached only
     * by the offline registry — stops applying `device.parameterValues`. The
     * assertion that reds is `toBeLessThanOrEqual(RESIDUAL_BUDGET_DBFS)`.
     */
    it('reds when the offline registry builds a device from its defaults instead of the project', async () => {
        vi.resetModules();
        vi.doMock('../../../repositories/deviceStrategy/WebAudioDeviceStrategy', async (importOriginal) => {
            const original =
                await importOriginal<typeof import('../../../repositories/deviceStrategy/WebAudioDeviceStrategy')>();
            const { createOfflineDeviceNode } = await import('../../../repositories/deviceNodeFactory');
            return {
                ...original,
                createWebAudioDevice: (ctx: BaseAudioContext, entry: Device) => {
                    const node = createOfflineDeviceNode({ context: ctx, device: entry, deviceType: entry.type });
                    if (!node) {
                        throw new Error(`broken fixture built no node for ${entry.type}`);
                    }
                    // The whole break: `applyParams(node, entry.type, entry.parameterValues)`
                    // is what production does here, and it is gone.
                    return new original.WebAudioDeviceStrategy(node, entry.type);
                },
            };
        });

        const { createOfflineTrackStrip: brokenOfflineStrip } = await import('../createOfflineTrackStrip');
        const fixture: TrackFixture = {
            ...BASE_TRACK,
            devices: [
                device({
                    id: 'd-filter',
                    type: 'builtin-filter',
                    // 300 Hz against the factory's 1000 Hz default: a whole
                    // octave and a half of the fixture signal's content moves.
                    parameterValues: { 'filter-cutoff': 300, 'filter-resonance': 1 },
                }),
            ],
        };

        const context = newContext();
        const master = context.createGain() as { gain: { value: number }; connect: (to: unknown) => unknown };
        master.gain.value = 1;
        master.connect(context.destination);
        const strip = await brokenOfflineStrip(context as unknown as OfflineAudioContext, {
            id: FIXTURE_TRACK_ID,
            name: fixture.name,
            gain: fixture.gain,
            muted: fixture.muted,
            pan: fixture.pan,
            devices: fixture.devices,
        });
        (strip.outputNode as unknown as { connect: (to: unknown) => unknown }).connect(master);
        const source = context.createSignalSource(
            createFixtureSignal({ frames: RENDER_FRAMES, sampleRate: SAMPLE_RATE })
        );
        source.connect(strip.inputNode);
        const broken = await context.startRendering();

        vi.doUnmock('../../../repositories/deviceStrategy/WebAudioDeviceStrategy');
        vi.resetModules();

        const live = await renderLive(fixture);
        const result = nullTest({ a: live.buffer, b: broken });

        // Both legs carry real signal, so the residual is a divergence and not
        // one side having gone silent.
        expect(result.signalPeakDbfs).toBeGreaterThan(-40);
        // The two claims AC-1 separates: it breaks the budget, and it breaks it
        // by an amount a listener would hear. Measured at −9.97 dBFS against a
        // −11.40 dBFS signal — the difference is louder than the programme.
        expect(result.residualPeakDbfs).toBeGreaterThan(RESIDUAL_BUDGET_DBFS);
        expect(result.residualPeakDbfs).toBeGreaterThan(RESIDUAL_DEFECT_DBFS);

        // The controlled half of the experiment: the same fixture and the same
        // live render, against the *unbroken* offline path. Without this the
        // test above proves only that something differed, not that the missing
        // `applyParams` is what differed.
        const correct = nullTest({ a: live.buffer, b: (await renderOffline(fixture)).buffer });
        expect(correct.residualPeakDbfs).toBeLessThanOrEqual(RESIDUAL_BUDGET_DBFS);
    });

    /**
     * The harness refuses to model a node it does not have, and on the live leg
     * that refusal reaches the caller. On the offline leg it does not:
     * `buildDeviceChain` catches every construction failure, warns, and
     * `continue`s, so the device is dropped and the render succeeds. Both legs
     * then lack the device and null against each other perfectly —
     * `builtin-delay`, `builtin-compressor`, `builtin-reverb` and
     * `builtin-tremolo` all measured `-Infinity` that way.
     *
     * The throwing `onWarning` in `renderOffline` is what closes that. Removing
     * it turns this test green-by-silence, which is the whole failure mode.
     */
    it('refuses a fixture whose device the offline chain dropped instead of building', async () => {
        const undeliverable = device({ id: 'fx-delay', type: 'builtin-delay', parameterValues: {} });

        await expect(renderOffline({ ...BASE_TRACK, devices: [undeliverable] })).rejects.toThrow(
            /degraded a fixtured device/
        );
    });

    /**
     * The presence pin proper (F3): a device type *neither* runtime recognises.
     * Live returns bare from `addDevice` when no factory and no wasm descriptor
     * claims the type (`TrackNode.ts:663-665`); offline degrades it away. A
     * signal-level pin cannot see this, because the strip still carries the
     * fixture at roughly −11 dBFS either way — measured `residual -Infinity,
     * signal -11.06 dBFS`, fully green. Only asserting the device is *present*
     * catches it, which is what a typo in a fixture's `type` would produce.
     */
    it('refuses a fixture whose device type neither runtime recognises', async () => {
        const misspelled = device({ id: 'fx-typo', type: 'levian', parameterValues: {} });

        await expect(renderLive({ ...BASE_TRACK, devices: [misspelled] })).rejects.toThrow(
            /rendered without fixtured device/
        );
    });

    /**
     * `connect()` models one argument and one kind of destination. Both refusals
     * matter because the silent alternatives are indistinguishable from correct
     * audio: an indexed connect would collapse onto input 0, and a connect to an
     * `AudioParam` would create no edge. Production does both —
     * `connectOfflineSidechainRoutes.ts:70` connects to input 1.
     */
    it('refuses the connect forms it does not model', () => {
        const context = newContext();
        const source = context.createGain() as { connect: (to: unknown, ...rest: unknown[]) => unknown };
        const target = context.createGain();

        expect(() => source.connect(target, 0, 1)).toThrow(/indexed connect/);
        expect(() => source.connect({ value: 0 })).toThrow(/AudioParam or foreign node/);
    });

    /**
     * The harness's other failure mode is the one ADR 0015 rule 4 warns about:
     * a null against two silent buffers. `expectNull` pins the signal for
     * exactly that reason, and this proves the pin is load-bearing rather than
     * ornamental.
     */
    it('refuses a null taken against silence', async () => {
        const silence: RenderedBuffer = {
            sampleRate: SAMPLE_RATE,
            length: RENDER_FRAMES,
            numberOfChannels: 2,
            getChannelData: () => new Float32Array(RENDER_FRAMES),
        };
        const result = nullTest({ a: silence, b: silence });

        expect(result.residualPeakDbfs).toBe(-Infinity);
        expect(() => expectNull(result)).toThrow();
    });
});

describe('live/offline null test — the instrument is sharp enough to matter', () => {
    /**
     * A null test is only as good as the resolution of the thing measuring it,
     * and every clean assertion in this file would stay green if the harness
     * quietly went blind — a `BiquadFilterNode` degraded to a pass-through
     * nulls perfectly against another pass-through. These probes are the
     * presence pin for the instrument itself (ADR 0015 rule 4): they inject a
     * divergence of known, deliberately tiny size and require the budget to
     * catch it. They red if the harness stops modelling the node, if a
     * parameter stops reaching it, or if someone widens the budget.
     *
     * The numbers are measurements, not guesses, taken on this fixture signal.
     */
    it('sees a fader divergence of one part in five hundred', async () => {
        const live = await renderLive({ ...BASE_TRACK, gain: 0.5 });
        const offline = await renderOffline({ ...BASE_TRACK, gain: 0.501 });
        const result = nullTest({ a: live.buffer, b: offline.buffer });

        // Measured −69.1 dBFS: over the budget, and still 9 dB below the point
        // AC-1 calls audible. The budget catches divergences nobody could hear.
        expect(result.residualPeakDbfs).toBeGreaterThan(RESIDUAL_BUDGET_DBFS);
        expect(result.residualPeakDbfs).toBeLessThan(RESIDUAL_DEFECT_DBFS);
    });

    it('sees a filter cutoff divergence of 1 Hz in 2400', async () => {
        // Perturbed from the fixture-table entry, so the probe stays tied to the
        // filter the clean tests actually render.
        const detuned: Device = {
            ...FIXTURE_DEVICES.filter,
            parameterValues: { ...FIXTURE_DEVICES.filter.parameterValues, 'filter-cutoff': 2401 },
        };
        const live = await renderLive({ ...BASE_TRACK, devices: [FIXTURE_DEVICES.filter] });
        const offline = await renderOffline({ ...BASE_TRACK, devices: [detuned] });
        const result = nullTest({ a: live.buffer, b: offline.buffer });

        // Measured −84.7 dBFS. Four hundredths of a percent of the cutoff is
        // over budget, which is what makes the clean nulls above worth having.
        expect(result.residualPeakDbfs).toBeGreaterThan(RESIDUAL_BUDGET_DBFS);
    });

    it('sees a pan divergence of one fifty-thousandth of full scale', async () => {
        const live = await renderLive({ ...BASE_TRACK, pan: 20 });
        const offline = await renderOffline({ ...BASE_TRACK, pan: 20.01 });
        const result = nullTest({ a: live.buffer, b: offline.buffer });

        // Measured −83.0 dBFS.
        expect(result.residualPeakDbfs).toBeGreaterThan(RESIDUAL_BUDGET_DBFS);
    });

    /**
     * The other way a clean null goes hollow: a fixture whose devices do not
     * actually shape the signal. Both legs would agree about nothing. Each
     * fixture device must move the render measurably away from a bare strip.
     */
    it.each(FIXTURE_DEVICE_ENTRIES)(
        'renders the %s device to something audibly unlike a bare strip',
        async (_name, entry) => {
            const bare = await renderOffline({ ...BASE_TRACK, gain: 1 });
            const rendered = await renderOffline({ ...BASE_TRACK, gain: 1, devices: [entry] });
            const difference = nullTest({ a: rendered.buffer, b: bare.buffer });

            expect(difference.residualPeakDbfs).toBeGreaterThan(-25);
        }
    );

    /**
     * The audibility guard above cannot see the one nonlinearity in the fixture
     * set, and that is worth stating plainly because it looked like it could.
     *
     * `createDistortion` is seven nodes: a dry/wet fork, a 4 kHz tone lowpass
     * and an output trim around the shaper. Blinding `HarnessWaveShaperNode`
     * into a pass-through still leaves those, and the distortion fixture's
     * distance from a bare strip only falls from −0.94 dBFS to −16.37 dBFS —
     * comfortably past the −25 threshold. So the guard stays green while the
     * only non-linear node in the harness does nothing, and every device the
     * file covers collapses to filters and multiplies.
     *
     * Homogeneity is the property that separates them. A chain of gains,
     * biquads and panners is linear, so scaling the input scales the output
     * exactly: `f(k·x) === k·f(x)`, to the bit. A waveshaper is the only
     * fixtured node for which that is false. Asserting the distortion fixture
     * *violates* homogeneity therefore reds the moment the shaper stops
     * shaping, and the linear control below proves the assertion is measuring
     * the nonlinearity rather than arithmetic noise.
     */
    it('renders its one nonlinearity as a nonlinearity', async () => {
        const fixture: TrackFixture = { ...BASE_TRACK, gain: 1, devices: [FIXTURE_DEVICES.distortion] };
        const full = await renderOffline(fixture);
        const halved = await renderOffline(fixture, { signalScale: 0.5 });
        const scaledFull = scaleBuffer(full.buffer, 0.5);
        const departure = nullTest({ a: halved.buffer, b: scaledFull });

        // Measured −22.9 dBFS of departure from linearity. Gutting
        // `HarnessWaveShaperNode.transform` takes this to −Infinity.
        expect(departure.residualPeakDbfs).toBeGreaterThan(-40);
    });

    it('renders a chain with no waveshaper in it as exactly linear', async () => {
        // The control. Same measurement, same signal, a fixture whose every node
        // is linear — so a non-zero result here would mean the homogeneity test
        // above detects something other than the shaper.
        const fixture: TrackFixture = {
            ...BASE_TRACK,
            gain: 1,
            devices: [FIXTURE_DEVICES.filter, FIXTURE_DEVICES.eq, FIXTURE_DEVICES.gain],
        };
        const full = await renderOffline(fixture);
        const halved = await renderOffline(fixture, { signalScale: 0.5 });
        const departure = nullTest({ a: halved.buffer, b: scaleBuffer(full.buffer, 0.5) });

        expect(departure.residualPeakDbfs).toBe(-Infinity);
    });
});

describe('live/offline null test — determinism', () => {
    /**
     * Survey stop condition 1: if a fixture is not reproducible run to run, the
     * "prove parity by null test" premise of this phase fails and needs
     * replacing. This is the check that would catch it, and it is why Yeast is
     * excluded from the fixture set rather than merely untested.
     */
    it('renders the same samples twice from the same fixture', async () => {
        const fixture: TrackFixture = {
            ...BASE_TRACK,
            gain: 0.62,
            pan: 18,
            devices: [FIXTURE_DEVICES.filter, FIXTURE_DEVICES.distortion],
        };

        const first = await renderLive(fixture);
        const second = await renderLive(fixture);
        const repeat = nullTest({ a: first.buffer, b: second.buffer });

        expect(repeat.signalPeakDbfs).toBeGreaterThan(-40);
        expect(repeat.residualPeakDbfs).toBe(-Infinity);
    });
});

// ---------------------------------------------------------------------------
// The backend axis
// ---------------------------------------------------------------------------

/**
 * The seam a real backend B occupies.
 *
 * One function: hand it a fixture, get back a render and the device ids that
 * render actually contained. Both existing legs already satisfy it —
 * `renderLive` and `renderOffline` are assignable as written — which is the
 * point. A backend is anything that can turn a track configuration into
 * samples, and the native engine will be swapped in by writing one more object
 * of this type. Nothing below reaches past it, so the swap touches this file in
 * exactly one place.
 *
 * `LegRender` rather than a bare buffer because the presence pin has to survive
 * the abstraction: a backend that silently rendered without a fixtured device
 * nulls perfectly against another backend that did the same. Both of today's
 * renderers call `assertDevicesBuilt` internally, and relying on that would
 * make the guard a convention rather than a contract — a D1 backend that simply
 * did not call it would lose the pin with nothing to notice. So the seam
 * re-checks it, on both legs, from the ids the backend reports.
 */
type RenderBackend = {
    id: string;
    render: (fixture: TrackFixture, options?: RenderOptions) => Promise<LegRender>;
};

/** Backend A: the Web Audio render path as an export builds it, today. */
const BACKEND_A: RenderBackend = { id: 'web-audio/offline', render: renderOffline };

/** The same renderer through the live builder — used to prove the seam is real. */
const BACKEND_A_LIVE: RenderBackend = { id: 'web-audio/live', render: renderLive };

/**
 * How a stand-in backend B misreads the fixture it is handed.
 *
 * A backend that renders a project differently is observationally identical to
 * a backend that renders a slightly different project, so a perturbation of the
 * configuration is a faithful stand-in for a divergence in the renderer — and,
 * unlike a hand-injected offset in the output samples, it is the shape the real
 * divergences take. A native backend gets a fader wrong by converting dB to
 * linear with a different rounding, a cutoff wrong by marshalling it through an
 * `f32`, a pan position wrong by normalising −100…100 with a different law.
 * Those are the three below.
 */
type FixtureMisread = (fixture: TrackFixture) => TrackFixture;

function standInBackendB(input: { name: string; misread: FixtureMisread }): RenderBackend {
    return {
        id: `stand-in/${input.name}`,
        render: (fixture, options) => renderOffline(input.misread(fixture), options),
    };
}

/** The un-perturbed stand-in. The green half of the experiment. */
const AGREEING_BACKEND_B = standInBackendB({ name: 'agrees', misread: (fixture) => fixture });

/**
 * Backend B, for real: the offline Web Audio renderer behind the
 * `AudioGraphBackend` contract.
 *
 * This is the seam's first non-stand-in occupant, and what it proves is narrower
 * than "two backends agree" — say the narrow thing rather than the flattering
 * one. The nodes underneath are the same nodes `renderOffline` builds, because
 * the contract's implementation is that code moved rather than rewritten, so a
 * null here cannot be evidence about *rendering*. What it is evidence about is
 * the **translation**: a fixture goes in as project truth, is expressed as
 * commands, and has to come back out as the same graph. Every place the
 * contract restates a law — the fader clamp, the pan scale, the mute gate's
 * position, which node a solo gate closes, what a device chain report contains —
 * is a place a second, wrong law could live, and this is what refuses one.
 *
 * The strip parameters go in **twice, deliberately**: once in the creating
 * command's `state`, and again as `write-parameter` steps carrying the same
 * project-truth values. The second pass is idempotent by construction — it
 * writes the value the strip already holds — and that is exactly what makes it
 * a probe rather than noise. `write-parameter` is the surface a lane, a mixer
 * move and the native engine's `AutomateParam` all arrive through, and it can
 * only be idempotent if it applies the same laws strip construction did. The
 * `faderAboveCeiling` fixture stores 1.8 and the `pannedStrip` fixture stores
 * −31: a write path that forgot `clampFaderGain` or the −50…50 pan scale reds
 * those two, loudly, instead of shipping a second level law nothing compares.
 */

/**
 * A fader driven by something other than a single step.
 *
 * `initialGain` is deliberately **not** the fixture's gain. If the creating
 * command already seeded the strip with the value the writes land on, a backend
 * that dropped `ramp-to`, `smoothed` and `hold` on the floor would null: the
 * strip would happen to hold the right level for the wrong reason. Creating the
 * strip somewhere else makes the writes the only route to the fixture's level,
 * so the clean leg is a statement that they arrived and were applied by the
 * laws the strip itself applies.
 */
type FaderAutomationPlan = {
    initialGain: number;
    /** Issued in order, in place of the fixture's single step write. */
    writes: AudioGraphParameterWrite[];
};

async function renderThroughContract(
    fixture: TrackFixture,
    options: RenderOptions = {},
    plan?: FaderAutomationPlan
): Promise<LegRender> {
    const context = newContext();
    const master = context.createGain() as { gain: { value: number }; connect: (to: unknown) => unknown };
    master.gain.value = 1;
    master.connect(context.destination);

    const backend = createWebAudioOfflineBackend({
        context: context as unknown as OfflineAudioContext,
        masterNode: master as unknown as AudioNode,
        // Same reason as `renderOffline`'s: a degraded device would otherwise
        // let this leg null against another graph that also lacks it.
        onWarning: throwOnDegradedDevice('contract backend'),
    });

    const faderWrites: AudioGraphParameterWrite[] = plan?.writes ?? [{ shape: 'step', value: fixture.gain, time: 0 }];

    const result = await backend.apply({
        schemaVersion: 1,
        commands: [
            {
                kind: 'create-track-strip',
                trackId: FIXTURE_TRACK_ID,
                name: fixture.name,
                state: {
                    gain: plan?.initialGain ?? fixture.gain,
                    pan: fixture.pan,
                    muted: fixture.muted,
                    soloGated: false,
                    vcaMultiplier: 1,
                },
                devices: fixture.devices,
                honorMuted: true,
                contributesAudio: true,
            },
            { kind: 'set-track-output', trackId: FIXTURE_TRACK_ID, target: { kind: 'master' } },
            ...faderWrites.map((write): AudioGraphCommand => ({
                kind: 'write-parameter',
                target: { kind: 'track-fader', trackId: FIXTURE_TRACK_ID },
                write,
            })),
            {
                kind: 'write-parameter',
                target: { kind: 'track-pan', trackId: FIXTURE_TRACK_ID },
                write: { shape: 'step', value: fixture.pan, time: 0 },
            },
            {
                kind: 'write-parameter',
                target: { kind: 'track-mute-gate', trackId: FIXTURE_TRACK_ID },
                write: { shape: 'step', value: fixture.muted ? 0 : 1, time: 0 },
            },
            {
                kind: 'write-parameter',
                target: { kind: 'track-solo-gate', trackId: FIXTURE_TRACK_ID },
                write: { shape: 'step', value: 1, time: 0 },
            },
        ],
    });

    if (result.application !== 'applied') {
        throw new Error(`contract backend refused the fixture batch: ${JSON.stringify(result)}`);
    }
    const report = result.reports.find((entry) => entry.id === FIXTURE_TRACK_ID);
    if (!report) {
        throw new Error('contract backend applied a strip command and reported no strip');
    }
    const strip = backend.getTrackStrip(FIXTURE_TRACK_ID);
    if (!strip) {
        throw new Error('contract backend reported a strip it does not hold');
    }

    const source = context.createSignalSource(fixtureSignal(options.signalScale ?? 1));
    source.connect(strip.inputNode);
    const buffer = await context.startRendering();
    return { buffer, builtDeviceIds: [...report.deviceIds] };
}

/** Backend B: the same render path, reached through the contract seam. */
const BACKEND_B_CONTRACT: RenderBackend = {
    id: 'audio-graph-backend/web-audio-offline',
    render: renderThroughContract,
};

/**
 * Every device the fixture asks for, in the ids the backend reported.
 *
 * Bypassed devices are excluded because the two runtimes already disagree about
 * whether a bypassed device is *present* — live keeps it in `deviceNodes`,
 * offline filters it out before construction — and a seam that took a side
 * would refuse a correct backend. What no backend may do is render without a
 * device that is supposed to be audible.
 */
function assertBackendBuiltDevices(input: { backend: RenderBackend; fixture: TrackFixture; render: LegRender }): void {
    assertDevicesBuilt({
        leg: `backend ${input.backend.id}`,
        expected: input.fixture.devices.filter((entry) => !entry.bypassed).map((entry) => entry.id),
        built: input.render.builtDeviceIds,
    });
}

async function nullTestBackends(input: {
    a: RenderBackend;
    b: RenderBackend;
    fixture: TrackFixture;
}): Promise<NullTestResult> {
    const a = await input.a.render(input.fixture);
    const b = await input.b.render(input.fixture);
    assertBackendBuiltDevices({ backend: input.a, fixture: input.fixture, render: a });
    assertBackendBuiltDevices({ backend: input.b, fixture: input.fixture, render: b });
    return nullTest({ a: a.buffer, b: b.buffer });
}

/**
 * The fixture set the backend leg sweeps: every device in the shared device
 * table, plus every shared strip and chain fixture leg one pins. Same
 * population, same budget, one axis changed — which is the only way a residual
 * here can be attributed to the backend rather than to a fixture the other legs
 * never render, and why both tables are read from `SHARED_FIXTURES` and
 * `FIXTURE_DEVICES` rather than restated here.
 */
const BACKEND_FIXTURES: Array<[string, TrackFixture]> = [
    ...Object.entries(SHARED_FIXTURES).map(([name, fixture]): [string, TrackFixture] => [name, fixture]),
    ...FIXTURE_DEVICE_ENTRIES.map(([name, entry]): [string, TrackFixture] => [
        `the ${name} device on its own`,
        { ...BASE_TRACK, devices: [entry] },
    ]),
];

type BackendDivergence = {
    /** What backend B got wrong. */
    name: string;
    /** The configuration both backends are asked for. */
    fixture: TrackFixture;
    /** What backend B rendered instead. */
    misread: FixtureMisread;
};

/**
 * The three divergences the sharpness probes above already measured, re-aimed
 * at the backend seam.
 *
 * The magnitudes are not re-derived and not chosen to be comfortably large:
 * they are one part in five hundred of a fader, 1 Hz in 2400 of a cutoff, and
 * one fifty-thousandth of full scale of a pan position — the exact quantities
 * this file already proves the −90 dBFS budget can see. Reusing them is what
 * makes the red half a statement about the *instrument's resolution at the
 * backend seam* rather than a statement that subtraction works.
 *
 * The residuals recorded below are a property of the perturbation and not of
 * which two legs were subtracted: measured across all four live/offline
 * pairings of the cutoff divergence, every one lands on the same residual at
 * the same frame, because the un-perturbed legs are bit-identical. So these
 * numbers are directly comparable with the probes'.
 */
const BACKEND_B_DIVERGENCES: BackendDivergence[] = [
    {
        // Measured −69.12 dBFS against a −15.14 dBFS signal.
        name: 'a fader that arrives one part in five hundred hot',
        fixture: { ...BASE_TRACK, gain: 0.5 },
        misread: (fixture) => ({ ...fixture, gain: 0.501 }),
    },
    {
        // Measured −78.11 dBFS against a −15.18 dBFS signal.
        name: 'a filter cutoff that arrives 1 Hz off in 2400',
        fixture: { ...BASE_TRACK, devices: [FIXTURE_DEVICES.filter] },
        misread: (fixture) => ({
            ...fixture,
            devices: fixture.devices.map((entry) =>
                entry.id === FIXTURE_DEVICES.filter.id
                    ? { ...entry, parameterValues: { ...entry.parameterValues, 'filter-cutoff': 2401 } }
                    : entry
            ),
        }),
    },
    {
        // Measured −82.96 dBFS against a −7.09 dBFS signal.
        name: 'a pan position that arrives one fifty-thousandth of full scale off',
        fixture: { ...BASE_TRACK, pan: 20 },
        misread: (fixture) => ({ ...fixture, pan: 20.01 }),
    },
];

describe('live/offline null test — the backend axis', () => {
    /**
     * The green half. Every fixture measures `-Infinity` today, because the
     * stand-in reaches the same renderer, and the assertion is deliberately the
     * −90 dBFS budget rather than that measurement.
     *
     * Pinning `-Infinity` would look stronger and would be a trap: two genuinely
     * independent backends cannot be bit-identical, so the first real backend B
     * would force this assertion to be *loosened* — and a budget that gets
     * loosened to admit the thing it was measuring is the exact failure the file
     * header refuses. −90 dBFS is the number backend B has to meet, so −90 dBFS
     * is the number asserted, from the day the seam exists. Nondeterminism in
     * backend A is caught by the determinism leg above, which does pin
     * `-Infinity` and is entitled to.
     */
    it.each(BACKEND_FIXTURES)('nulls %s across the backend seam', async (_name, fixture) => {
        expectNull(await nullTestBackends({ a: BACKEND_A, b: AGREEING_BACKEND_B, fixture }));
    });

    /**
     * The same sweep against the contract-backed backend.
     *
     * Same population, same budget, same seam — including the device pin, which
     * `nullTestBackends` applies to both legs from the ids each backend reports.
     * A contract implementation that built the chain and forgot to report it, or
     * reported a device it degraded away, is refused here rather than nulling
     * silently against a backend that dropped the same device.
     */
    it.each(BACKEND_FIXTURES)('nulls %s through the contract-backed backend', async (_name, fixture) => {
        expectNull(await nullTestBackends({ a: BACKEND_A, b: BACKEND_B_CONTRACT, fixture }));
    });

    /**
     * The contract carries a live builder's output too.
     *
     * Leg one's four-device chain, subtracted between the live strip and the
     * contract-backed one. `renderLive` never touches the contract, so this is
     * the pairing where a law the contract restated wrongly cannot be cancelled
     * out by both sides restating it the same way.
     */
    it('nulls the live builder against the contract-backed backend', async () => {
        expectNull(
            await nullTestBackends({
                a: BACKEND_A_LIVE,
                b: BACKEND_B_CONTRACT,
                fixture: SHARED_FIXTURES.chainInProjectOrder,
            })
        );
    });

    /**
     * The contract refuses what it cannot do, rather than accepting it.
     *
     * An `OfflineAudioContext` has no rack to splice into and no playhead to
     * move, and the failure mode worth guarding is not the refusal — it is the
     * *silent* alternative, where a backend accepts `set-transport`, does
     * nothing, and the caller learns from a wrong file. The refusal also has to
     * take the whole batch: the strip command ahead of it must not have been
     * applied, or a caller retrying against a different backend builds it twice.
     */
    it('refuses a batch carrying a command an offline render cannot answer', async () => {
        const context = newContext();
        const master = context.createGain() as { gain: { value: number }; connect: (to: unknown) => unknown };
        master.connect(context.destination);
        const backend = createWebAudioOfflineBackend({
            context: context as unknown as OfflineAudioContext,
            masterNode: master as unknown as AudioNode,
        });

        const result = await backend.apply({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'create-track-strip',
                    trackId: FIXTURE_TRACK_ID,
                    name: 'Fixture',
                    state: { gain: 1, pan: 0, muted: false, soloGated: false, vcaMultiplier: 1 },
                    devices: [],
                    honorMuted: true,
                    contributesAudio: true,
                },
                { kind: 'set-transport', playing: true, positionSeconds: 0 },
            ],
        });

        expect(result.acceptance).toBe('rejected');
        expect(result.application).toBe('not-applied');
        expect(backend.getTrackStrip(FIXTURE_TRACK_ID)).toBeUndefined();
    });

    /**
     * The seam is driven by two genuinely different implementations.
     *
     * Be precise about what this does and does not carry, because the two are
     * easy to swap. That `renderLive` *fits* the slot is settled by the type
     * annotation on `BACKEND_A_LIVE` — the file would not typecheck otherwise —
     * and no runtime assertion is doing that work. Deleting the annotation is
     * not made safe by this test.
     *
     * What the null adds is that the seam's own machinery survives a renderer
     * it was not shaped around. `renderOffline` is the one every other test
     * here drives; `renderLive` awaits a microtask rebuild before it renders,
     * builds a different node graph, and reports bypassed devices in
     * `builtDeviceIds` where offline omits them — so it exercises the ordering
     * `nullTestBackends` imposes and the device pin it now applies to both
     * legs. A seam that only ever receives one renderer is wrong in ways
     * nothing notices until a second one arrives, and a native backend is that
     * second one.
     *
     * Measured `-Infinity` on this four-device chain: leg one's result restated
     * through the seam, which is what makes the restatement worth its render.
     */
    it('accepts two independently-written implementations in the same slot', async () => {
        expectNull(
            await nullTestBackends({
                a: BACKEND_A_LIVE,
                b: BACKEND_A,
                fixture: SHARED_FIXTURES.chainInProjectOrder,
            })
        );
    });

    /**
     * The seam's presence pin is a contract, not a convention.
     *
     * Both of today's renderers refuse internally, so nothing in the leg above
     * can distinguish a seam that re-checks from one that trusts. This backend
     * renders correct audio and reports no devices — exactly what a D1 backend
     * that forgot the internal guard looks like — and the null it would produce
     * against backend A is a clean one. `nullTestBackends` has to be what
     * refuses it.
     */
    it('refuses a backend that reports it rendered without the fixtured devices', async () => {
        const forgetful: RenderBackend = {
            id: 'forgetful',
            render: async (fixture, options) => ({ ...(await renderOffline(fixture, options)), builtDeviceIds: [] }),
        };

        await expect(
            nullTestBackends({ a: BACKEND_A, b: forgetful, fixture: SHARED_FIXTURES.chainInProjectOrder })
        ).rejects.toThrow(/rendered without fixtured device/);
    });

    /**
     * The red half. Both claims are asserted per divergence:
     *
     *   1. the perturbed backend B breaks the budget — the leg is an instrument;
     *   2. it breaks it by an amount **below** the audible line — the residual
     *      is the injected divergence and not a backend that dropped a device,
     *      went silent or lost a whole chain. A gross failure would clear
     *      −60 dBFS and this assertion would refuse it, which is what keeps a
     *      red for the wrong reason from being read as a red for the right one.
     *
     * The controlled half runs immediately after, on the same fixture through
     * the agreeing backend B, so a red cannot be attributed to the fixture.
     */
    it.each(BACKEND_B_DIVERGENCES)('reds when backend B renders $name', async (divergence) => {
        const perturbed = await nullTestBackends({
            a: BACKEND_A,
            b: standInBackendB({ name: divergence.name, misread: divergence.misread }),
            fixture: divergence.fixture,
        });

        expect(perturbed.signalPeakDbfs).toBeGreaterThan(-40);
        expect(
            perturbed.residualPeakDbfs,
            `perturbed backend B nulled at ${perturbed.residualPeakDbfs.toFixed(2)} dBFS — the leg is blind`
        ).toBeGreaterThan(RESIDUAL_BUDGET_DBFS);
        expect(perturbed.residualPeakDbfs).toBeLessThan(RESIDUAL_DEFECT_DBFS);

        const agreeing = await nullTestBackends({
            a: BACKEND_A,
            b: AGREEING_BACKEND_B,
            fixture: divergence.fixture,
        });

        expectNull(agreeing);
    });

    /**
     * The same red half, aimed at the contract-backed backend.
     *
     * Without this the leg above is a green file and nothing more: a
     * `renderThroughContract` that quietly rendered a bare strip, dropped the
     * device chain, or ignored the parameter writes would null perfectly
     * against backend A on most of the fixture table. Handing the *contract*
     * backend the three divergences this file already proves visible is what
     * makes its green half a measurement — and the same two claims are asserted,
     * so a red for a gross reason cannot be read as a red for the injected one.
     */
    it.each(BACKEND_B_DIVERGENCES)('reds when the contract-backed backend renders $name', async (divergence) => {
        const perturbed = await nullTestBackends({
            a: BACKEND_A,
            b: {
                id: `audio-graph-backend/${divergence.name}`,
                render: (fixture, options) => renderThroughContract(divergence.misread(fixture), options),
            },
            fixture: divergence.fixture,
        });

        expect(perturbed.signalPeakDbfs).toBeGreaterThan(-40);
        expect(
            perturbed.residualPeakDbfs,
            `perturbed contract backend nulled at ${perturbed.residualPeakDbfs.toFixed(2)} dBFS — the leg is blind`
        ).toBeGreaterThan(RESIDUAL_BUDGET_DBFS);
        expect(perturbed.residualPeakDbfs).toBeLessThan(RESIDUAL_DEFECT_DBFS);

        expectNull(await nullTestBackends({ a: BACKEND_A, b: BACKEND_B_CONTRACT, fixture: divergence.fixture }));
    });
});

// ---------------------------------------------------------------------------
// The four contract gaps: sends and solo, bus chains, automation writes, clips
// ---------------------------------------------------------------------------

/**
 * Everything above this line renders **one strip**, and that is the shape of the
 * blind spot #2099 records: the four behaviors the `AudioGraphBackend` contract
 * was widened to carry (jcosta33/sourdaw#2085) are exactly the four a
 * single-strip fixture cannot reach.
 *
 * Each fixture below is built the same way the contract legs above are — a
 * reference graph assembled from the production builders, and the same graph
 * expressed as commands — so a residual is a statement about the *translation*
 * and not about rendering, for the reason `renderThroughContract` states. What
 * is new is the population, not the claim.
 *
 * Each also ships its perturbed twin, and the twins state which side of the
 * audible line they are supposed to land on rather than leaving a red
 * unqualified: `inaudible` proves the instrument's resolution at that seam,
 * `audible` proves the consequence of the defect it stands in for.
 */
type ResidualBand = 'inaudible' | 'audible';

function expectPerturbedRed(input: { result: NullTestResult; band: ResidualBand; leg: string }): void {
    const { result, band, leg } = input;
    expect(result.signalPeakDbfs).toBeGreaterThan(-40);
    expect(
        result.residualPeakDbfs,
        `perturbed ${leg} nulled at ${result.residualPeakDbfs.toFixed(2)} dBFS — the leg is blind`
    ).toBeGreaterThan(band === 'inaudible' ? RESIDUAL_BUDGET_DBFS : RESIDUAL_DEFECT_DBFS);
    // The upper claim is what separates "the injected divergence" from "the
    // backend fell over". An `inaudible` red that clears −60 dBFS is a red for
    // the wrong reason and is refused here rather than counted as coverage.
    expect(result.residualPeakDbfs).toBeLessThan(band === 'inaudible' ? RESIDUAL_DEFECT_DBFS : 0);
}

// ---------------------------------------------------------------------------
// Gap 1 and 2: the pre-fader send tap, the solo gate, and a bus with a chain
// ---------------------------------------------------------------------------

const KEEPER_TRACK_ID = 'track-2';
const SEND_BUS_ID = 'bus-1';
/**
 * The keeper's signal, as a power of two so the scaling is exact in binary
 * floating point and contributes no round-off of its own.
 */
const KEEPER_SIGNAL_SCALE = 0.5;

/**
 * Two strips and a bus.
 *
 * The `keeper` exists so the presence pin survives the variant under test: a
 * solo-gated source renders digital silence through both its output and its
 * send, and a null taken against two silences is the failure ADR 0015 rule 4
 * names. A second strip straight to master keeps real programme in both legs
 * while the gate does its work.
 */
type GraphFixture = {
    /** The strip whose gate the variant moves. Its send is the thing under test. */
    source: TrackFixture & { soloGated: boolean };
    /** A second strip straight to master, so a gated source cannot silence the render. */
    keeper: TrackFixture;
    /** The bus the send feeds. It carries its own device chain — #2085 §2. */
    bus: TrackFixture;
    /** Stored linear send level, tapped pre-fader. */
    sendLevel: number;
};

function stripInput(
    fixture: TrackFixture,
    id: string
): {
    id: string;
    name: string;
    gain: number;
    muted: boolean;
    pan: number;
    devices: Device[];
} {
    return {
        id,
        name: fixture.name,
        gain: fixture.gain,
        muted: fixture.muted,
        pan: fixture.pan,
        devices: fixture.devices,
    };
}

function expectedGraphDeviceIds(fixture: GraphFixture): string[] {
    return [fixture.bus, fixture.source, fixture.keeper].flatMap((strip) =>
        strip.devices.filter((entry) => !entry.bypassed).map((entry) => entry.id)
    );
}

/**
 * The reference graph: the production builders, wired by hand exactly as the
 * export's own send loop wires them.
 *
 * The solo gate is written where `createWebAudioOfflineBackend` writes it and
 * nowhere else — `preFaderTap.gain`, upstream of the send tap. That is the
 * whole content of the fixture: a runtime that closed the *post*-fader gate
 * instead would silence the output and keep feeding the bus.
 */
async function renderSendGraphOffline(fixture: GraphFixture): Promise<LegRender> {
    const context = newContext();
    const master = newMaster(context);
    const onWarning = throwOnDegradedDevice('offline send graph');
    const offlineContext = context as unknown as OfflineAudioContext;

    const busTrackStrip = await createOfflineTrackStrip(offlineContext, stripInput(fixture.bus, SEND_BUS_ID), {
        onWarning,
    });
    const bus = createOfflineBusStrip(busTrackStrip);
    const source = await createOfflineTrackStrip(offlineContext, stripInput(fixture.source, FIXTURE_TRACK_ID), {
        onWarning,
    });
    if (fixture.source.soloGated) {
        source.preFaderTap.gain.value = 0;
    }
    const keeper = await createOfflineTrackStrip(offlineContext, stripInput(fixture.keeper, KEEPER_TRACK_ID), {
        onWarning,
    });

    connectNodes(busTrackStrip.outputNode, master);
    connectNodes(source.outputNode, master);
    connectNodes(keeper.outputNode, master);

    const sendGain = context.createGain() as { gain: { value: number } };
    sendGain.gain.value = Math.max(0, Math.min(1, fixture.sendLevel));
    connectNodes(source.preFaderTap, sendGain);
    connectNodes(sendGain, bus.gainNode);

    connectNodes(context.createSignalSource(fixtureSignal(1)), source.inputNode);
    connectNodes(context.createSignalSource(fixtureSignal(KEEPER_SIGNAL_SCALE)), keeper.inputNode);

    const buffer = await context.startRendering();
    return {
        buffer,
        builtDeviceIds: [...busTrackStrip.deviceEntries, ...source.deviceEntries, ...keeper.deviceEntries].map(
            (entry) => entry.deviceId
        ),
    };
}

function sendGraphCommands(fixture: GraphFixture): AudioGraphCommand[] {
    return [
        {
            kind: 'create-bus-strip',
            busId: SEND_BUS_ID,
            name: fixture.bus.name,
            state: {
                gain: fixture.bus.gain,
                pan: fixture.bus.pan,
                muted: fixture.bus.muted,
                soloGated: false,
                vcaMultiplier: 1,
            },
            devices: fixture.bus.devices,
            honorMuted: true,
            contributesAudio: true,
        },
        {
            kind: 'create-track-strip',
            trackId: FIXTURE_TRACK_ID,
            name: fixture.source.name,
            state: {
                gain: fixture.source.gain,
                pan: fixture.source.pan,
                muted: fixture.source.muted,
                soloGated: fixture.source.soloGated,
                vcaMultiplier: 1,
            },
            devices: fixture.source.devices,
            honorMuted: true,
            contributesAudio: true,
        },
        {
            kind: 'create-track-strip',
            trackId: KEEPER_TRACK_ID,
            name: fixture.keeper.name,
            state: {
                gain: fixture.keeper.gain,
                pan: fixture.keeper.pan,
                muted: fixture.keeper.muted,
                soloGated: false,
                vcaMultiplier: 1,
            },
            devices: fixture.keeper.devices,
            honorMuted: true,
            contributesAudio: true,
        },
        // A bus is addressed by putting its strip id in `trackId`; there is no
        // `set-bus-output`. One id space is contract law, and a backend that
        // kept two would fail here rather than in a bounce.
        { kind: 'set-track-output', trackId: SEND_BUS_ID, target: { kind: 'master' } },
        { kind: 'set-track-output', trackId: FIXTURE_TRACK_ID, target: { kind: 'master' } },
        { kind: 'set-track-output', trackId: KEEPER_TRACK_ID, target: { kind: 'master' } },
        { kind: 'add-send', trackId: FIXTURE_TRACK_ID, busId: SEND_BUS_ID, tap: 'pre-fader', level: fixture.sendLevel },
    ];
}

async function renderSendGraphThroughContract(fixture: GraphFixture): Promise<LegRender> {
    const context = newContext();
    const master = newMaster(context);

    const backend = createWebAudioOfflineBackend({
        context: context as unknown as OfflineAudioContext,
        masterNode: master as AudioNode,
        onWarning: throwOnDegradedDevice('contract send graph'),
    });

    const result = await backend.apply({ schemaVersion: 1, commands: sendGraphCommands(fixture) });
    if (result.application !== 'applied') {
        throw new Error(`contract backend refused the send-graph batch: ${JSON.stringify(result)}`);
    }
    const source = backend.getTrackStrip(FIXTURE_TRACK_ID);
    const keeper = backend.getTrackStrip(KEEPER_TRACK_ID);
    if (!source || !keeper) {
        throw new Error('contract backend applied three strip commands and holds fewer than three strips');
    }

    connectNodes(context.createSignalSource(fixtureSignal(1)), source.inputNode);
    connectNodes(context.createSignalSource(fixtureSignal(KEEPER_SIGNAL_SCALE)), keeper.inputNode);

    const buffer = await context.startRendering();
    return { buffer, builtDeviceIds: result.reports.flatMap((report) => [...report.deviceIds]) };
}

type GraphMisread = (fixture: GraphFixture) => GraphFixture;

async function nullTestSendGraph(input: { fixture: GraphFixture; misread?: GraphMisread }): Promise<NullTestResult> {
    const misread = input.misread ?? ((fixture: GraphFixture) => fixture);
    const asked = misread(input.fixture);
    const reference = await renderSendGraphOffline(input.fixture);
    const contract = await renderSendGraphThroughContract(asked);
    assertDevicesBuilt({
        leg: 'offline send graph',
        expected: expectedGraphDeviceIds(input.fixture),
        built: reference.builtDeviceIds,
    });
    assertDevicesBuilt({
        leg: 'contract send graph',
        expected: expectedGraphDeviceIds(asked),
        built: contract.builtDeviceIds,
    });
    return nullTest({ a: reference.buffer, b: contract.buffer });
}

const SEND_GRAPH_BASE: GraphFixture = {
    source: { name: 'Source', gain: 0.74, pan: -18, muted: false, soloGated: false, devices: [FIXTURE_DEVICES.gain] },
    keeper: { name: 'Keeper', gain: 0.55, pan: 22, muted: false, devices: [] },
    // An EQ rather than the filter: the bus device has to shape the send without
    // burying it, or the one-part-in-five-hundred send-level probe below would
    // be measuring the device's attenuation rather than the instrument's floor.
    bus: { name: 'Bus', gain: 0.9, pan: 0, muted: false, devices: [FIXTURE_DEVICES.eq] },
    sendLevel: 0.62,
};

/** Solo-gated and muted, differing at nothing but which gate is closed. */
const SOLO_GATED_SOURCE: GraphFixture = {
    ...SEND_GRAPH_BASE,
    source: { ...SEND_GRAPH_BASE.source, soloGated: true },
};
const MUTED_SOURCE: GraphFixture = {
    ...SEND_GRAPH_BASE,
    source: { ...SEND_GRAPH_BASE.source, muted: true },
};

const SEND_GRAPH_FIXTURES: Array<[string, GraphFixture]> = [
    ['a source feeding a bus through a pre-fader send', SEND_GRAPH_BASE],
    ['a solo-gated source, whose send is gated with it', SOLO_GATED_SOURCE],
    ['a muted source, whose pre-fader send keeps feeding its bus', MUTED_SOURCE],
];

const SEND_GRAPH_DIVERGENCES: Array<{
    name: string;
    fixture: GraphFixture;
    misread: GraphMisread;
    band: ResidualBand;
}> = [
    {
        // The defect the whole fixture exists for. The native strip has one
        // `muted` flag applied post-fader (#2085 §1), so a backend that folded
        // solo into it puts the gate downstream of the send tap and a non-soloed
        // track keeps feeding its cue bus at full level.
        //
        // Measured −16.30 dBFS against a −16.10 dBFS signal: the residual is the
        // whole bus, as loud as the programme. This is the one divergence in the
        // file that is *supposed* to clear the audible line.
        name: 'folds the solo gate into the mute gate',
        fixture: SOLO_GATED_SOURCE,
        misread: (fixture) => ({
            ...fixture,
            source: { ...fixture.source, soloGated: false, muted: true },
        }),
        band: 'audible',
    },
    {
        // The same magnitude the fader probe above proves visible, aimed at the
        // send level instead: this is what a native backend marshalling the
        // level through an `f32` produces. Measured −70.28 dBFS against a
        // −10.79 dBFS signal — over budget, twenty dB below audible.
        name: 'takes a send level one part in five hundred hot',
        fixture: MUTED_SOURCE,
        misread: (fixture) => ({ ...fixture, sendLevel: fixture.sendLevel * 1.002 }),
        band: 'inaudible',
    },
];

describe('live/offline null test — sends, solo gates and bus chains', () => {
    it.each(SEND_GRAPH_FIXTURES)('nulls %s through the contract-backed backend', async (_name, fixture) => {
        expectNull(await nullTestSendGraph({ fixture }));
    });

    /**
     * The claim the two variants exist to make.
     *
     * Solo-in-place and mute are different gates in different places, and the
     * only observable that separates them is what reaches the bus: a muted
     * track's pre-fader send still feeds its cue mix, a solo-gated one's does
     * not. If the two renders were identical, every null above would still be
     * green and the fixture would be measuring nothing — so this is the pin
     * that makes the pair worth rendering.
     */
    it('renders a solo-gated source and a muted one as different mixes', async () => {
        const gated = await renderSendGraphThroughContract(SOLO_GATED_SOURCE);
        const muted = await renderSendGraphThroughContract(MUTED_SOURCE);
        const difference = nullTest({ a: muted.buffer, b: gated.buffer });

        expect(difference.signalPeakDbfs).toBeGreaterThan(-40);
        // The bus's whole contribution, which only the muted variant carries.
        expect(difference.residualPeakDbfs).toBeGreaterThan(-25);
    });

    it.each(SEND_GRAPH_DIVERGENCES)('reds when the contract-backed backend $name', async (divergence) => {
        expectPerturbedRed({
            result: await nullTestSendGraph({ fixture: divergence.fixture, misread: divergence.misread }),
            band: divergence.band,
            leg: 'send graph',
        });

        expectNull(await nullTestSendGraph({ fixture: divergence.fixture }));
    });
});

// ---------------------------------------------------------------------------
// Gap 3: cancel-and-replace automation, and the hold
// ---------------------------------------------------------------------------

/**
 * A fader written by something other than a step, and what a backend that got
 * one thing wrong would have written instead.
 *
 * These render on a **settled** context, which is what makes them measurable at
 * all: the harness collapses each timeline to the value it comes to rest on, so
 * what is compared is where a cancel-and-replace sequence *ends up*, against a
 * strip built at that level directly. See the automation notes in
 * `nullTestRenderHarness`.
 */
const FADER_AUTOMATION_FIXTURES: Array<{
    name: string;
    misreadName: string;
    band: ResidualBand;
    fixture: TrackFixture;
    plan: FaderAutomationPlan;
    misread: FaderAutomationPlan;
}> = [
    {
        /**
         * Two `ramp-to` writes whose spans overlap, with the **first** landing
         * later than the second. That ordering is the entire fixture: it is what
         * makes the cancel half of cancel-and-replace the thing being measured
         * rather than the ramp. A backend that appends comes to rest on 0.19 —
         * the stale target of the write it should have dropped — and a backend
         * that ignores `ramp-to` altogether stays at the 0.77 the strip was
         * created with. Only cancel-and-replace lands on 0.42.
         */
        name: 'two overlapping ramp-to writes, the second replacing the first',
        // Measured −70.64 dBFS against a −16.66 dBFS signal.
        misreadName: 'lands a replacing ramp one part in five hundred hot',
        band: 'inaudible',
        fixture: { ...BASE_TRACK, gain: 0.42 },
        plan: {
            initialGain: 0.77,
            writes: [
                { shape: 'ramp-to', value: 0.19, startTime: 0.1, landTime: 0.3 },
                { shape: 'ramp-to', value: 0.42, startTime: 0.15, landTime: 0.25 },
            ],
        },
        misread: {
            initialGain: 0.77,
            writes: [
                { shape: 'ramp-to', value: 0.19, startTime: 0.1, landTime: 0.3 },
                { shape: 'ramp-to', value: 0.42084, startTime: 0.15, landTime: 0.25 },
            ],
        },
    },
    {
        /**
         * A `hold` closing the sequence, with a ramp still pending ahead of it.
         *
         * What is pinned is the half the contract states without ambiguity —
         * "drop every pending event" — and nothing else: the hold sits at 0.10,
         * before the pending ramp's own `startTime`, so the level it holds is
         * the same number whether a backend reads the parameter's current value
         * or evaluates its timeline at the hold. A backend that dropped the
         * `hold` command instead of applying it comes to rest on 0.62124, the
         * target of the ramp the hold was supposed to cancel.
         */
        name: 'a hold that drops a ramp still pending',
        // Measured −67.25 dBFS against a −13.27 dBFS signal.
        misreadName: 'drops the hold instead of applying it',
        band: 'inaudible',
        fixture: { ...BASE_TRACK, gain: 0.62 },
        plan: {
            initialGain: 0.62,
            writes: [
                { shape: 'ramp-to', value: 0.62124, startTime: 0.2, landTime: 0.3 },
                { shape: 'hold', time: 0.1 },
            ],
        },
        misread: {
            initialGain: 0.62,
            writes: [{ shape: 'ramp-to', value: 0.62124, startTime: 0.2, landTime: 0.3 }],
        },
    },
    {
        /**
         * The third write shape, and the one an interactive mixer move uses. It
         * never lands exactly, so what a settled harness reads is the target it
         * approaches — which is the level the session comes to rest at once the
         * engineer lets go of the fader, and therefore the level a bounce owes.
         */
        name: 'a smoothed write settling on its target',
        // Measured −66.45 dBFS against a −12.47 dBFS signal.
        misreadName: 'settles a smoothed write one part in five hundred hot',
        band: 'inaudible',
        fixture: { ...BASE_TRACK, gain: 0.68 },
        plan: {
            initialGain: 0.35,
            writes: [{ shape: 'smoothed', value: 0.68, time: 0.05, timeConstantSeconds: 0.01 }],
        },
        misread: {
            initialGain: 0.35,
            writes: [{ shape: 'smoothed', value: 0.68136, time: 0.05, timeConstantSeconds: 0.01 }],
        },
    },
];

function contractBackendWithPlan(name: string, plan: FaderAutomationPlan): RenderBackend {
    return {
        id: `audio-graph-backend/${name}`,
        render: (fixture, options) => renderThroughContract(fixture, options, plan),
    };
}

describe('live/offline null test — automation writes across the backend seam', () => {
    it.each(FADER_AUTOMATION_FIXTURES)('nulls a fader driven by $name', async (entry) => {
        expectNull(
            await nullTestBackends({
                a: BACKEND_A,
                b: contractBackendWithPlan(entry.name, entry.plan),
                fixture: entry.fixture,
            })
        );
    });

    it.each(FADER_AUTOMATION_FIXTURES)('reds when the contract-backed backend $misreadName', async (entry) => {
        expectPerturbedRed({
            result: await nullTestBackends({
                a: BACKEND_A,
                b: contractBackendWithPlan(entry.misreadName, entry.misread),
                fixture: entry.fixture,
            }),
            band: entry.band,
            leg: 'automation plan',
        });

        expectNull(
            await nullTestBackends({
                a: BACKEND_A,
                b: contractBackendWithPlan(entry.name, entry.plan),
                fixture: entry.fixture,
            })
        );
    });
});

// ---------------------------------------------------------------------------
// Gap 4: a scheduled clip, with the fades that keep its edges from clicking
// ---------------------------------------------------------------------------

/** The clip's material. Deterministic, broadband, and asymmetric across channels. */
const CLIP_MATERIAL = createFixtureAudioBuffer({ frames: RENDER_FRAMES, sampleRate: SAMPLE_RATE });

/**
 * The same material, twice as long.
 *
 * A clip sped up past unity consumes more source seconds than the destination
 * span it fills, so a fixture that shares the render's own length would hit the
 * end of the buffer and fall silent for that reason instead of the one under
 * test.
 */
const LONG_CLIP_MATERIAL = createFixtureAudioBuffer({ frames: RENDER_FRAMES * 2, sampleRate: SAMPLE_RATE });

/**
 * One playback, with a user fade in and a user fade out.
 *
 * `playDurationSec` is destination seconds whatever `playbackRate` is — that is
 * the law `AudioGraphClipPlayback.durationSeconds` states — so a stretched
 * variant of a fixture keeps every one of its absolute times and changes only
 * how much material is consumed to fill them.
 */
type ClipFixture = {
    strip: TrackFixture;
    /** What is played. Both legs read the same buffer, sample for sample. */
    material: HarnessAudioBuffer;
    startSec: number;
    bufferOffsetSec: number;
    playDurationSec: number;
    /** Source frames consumed per destination frame; `1` is unstretched. */
    playbackRate: number;
    /** Absolute destination time the user's fade in reaches full level. */
    fadeInReachesFullAt: number;
    /** Absolute destination time the user's fade out begins. */
    fadeOutBeginsAt: number;
    clipGain: number;
};

const CLIP_START_SEC = 0.05;
const CLIP_DURATION_SEC = 0.4;

const CLIP_FIXTURE: ClipFixture = {
    strip: { ...BASE_TRACK, name: 'Clip', gain: 0.8, devices: [FIXTURE_DEVICES.filter] },
    material: CLIP_MATERIAL,
    startSec: CLIP_START_SEC,
    bufferOffsetSec: 0.02,
    playDurationSec: CLIP_DURATION_SEC,
    playbackRate: 1,
    fadeInReachesFullAt: CLIP_START_SEC + 0.06,
    fadeOutBeginsAt: CLIP_START_SEC + CLIP_DURATION_SEC - 0.08,
    clipGain: 0.7,
};

/**
 * The same playback, stretched — once each side of unity.
 *
 * A stretched clip is its own divergence class, and it is the only one this
 * file could not see before: `durationSeconds` is destination seconds while
 * `AudioBufferSourceNode.start`'s third argument is source seconds, and at
 * rate 1 those are the same number, so every fixture above is green whichever
 * one a runtime hands over. Hand the wrong one here and the clip sounds for
 * `duration / rate` — half of its region, or twice it.
 *
 * Both directions are fixtured because they fail in opposite directions and a
 * single rate leaves one of them unmeasured: too slow overruns the region,
 * where the clip's own fade out can mask it, and too fast falls silent inside
 * the region, where nothing masks it at all.
 */
const SLOWED_CLIP_FIXTURE: ClipFixture = {
    ...CLIP_FIXTURE,
    strip: { ...CLIP_FIXTURE.strip, name: 'Half-speed clip' },
    playbackRate: 0.5,
};

const SPED_UP_CLIP_FIXTURE: ClipFixture = {
    ...CLIP_FIXTURE,
    strip: { ...CLIP_FIXTURE.strip, name: 'Sped-up clip' },
    material: LONG_CLIP_MATERIAL,
    playbackRate: 1.5,
};

const STRETCHED_CLIP_FIXTURES = [SLOWED_CLIP_FIXTURE, SPED_UP_CLIP_FIXTURE];

/**
 * The reference leg: `scheduleOfflineClipSource` called directly, which is what
 * `scheduleTrackClips` — the export's only clip caller — does.
 *
 * Both legs run the same body, so what a residual here reports is the
 * *translation* the contract performs: which absolute times the fade edges
 * arrive on, that an absent time still means the anti-click floor, and that the
 * clip's own gain is not folded in twice.
 */
async function renderClipOffline(fixture: ClipFixture): Promise<LegRender> {
    const context = newContext({ automation: 'scheduled' });
    const master = newMaster(context);

    const strip = await createOfflineTrackStrip(
        context as unknown as OfflineAudioContext,
        stripInput(fixture.strip, FIXTURE_TRACK_ID),
        { onWarning: throwOnDegradedDevice('offline clip leg') }
    );
    connectNodes(strip.outputNode, master);

    scheduleOfflineClipSource({
        context: context as unknown as BaseAudioContext,
        destinationNode: strip.inputNode,
        buffer: fixture.material as unknown as AudioBuffer,
        startSec: fixture.startSec,
        bufferOffsetSec: fixture.bufferOffsetSec,
        playDuration: fixture.playDurationSec,
        playbackRate: fixture.playbackRate,
        clipGainValue: fixture.clipGain,
        fadeIn: { userEndSec: fixture.fadeInReachesFullAt },
        fadeOut: { userStartSec: fixture.fadeOutBeginsAt },
        microFadeSeconds: MICRO_FADE_SECONDS,
    });

    const buffer = await context.startRendering();
    return { buffer, builtDeviceIds: strip.deviceEntries.map((entry) => entry.deviceId) };
}

async function renderClipThroughContract(fixture: ClipFixture): Promise<LegRender> {
    const context = newContext({ automation: 'scheduled' });
    const master = newMaster(context);

    const backend = createWebAudioOfflineBackend({
        context: context as unknown as OfflineAudioContext,
        masterNode: master as AudioNode,
        onWarning: throwOnDegradedDevice('contract clip leg'),
    });

    const result = await backend.apply({
        schemaVersion: 1,
        commands: [
            {
                kind: 'create-track-strip',
                trackId: FIXTURE_TRACK_ID,
                name: fixture.strip.name,
                state: {
                    gain: fixture.strip.gain,
                    pan: fixture.strip.pan,
                    muted: fixture.strip.muted,
                    soloGated: false,
                    vcaMultiplier: 1,
                },
                devices: fixture.strip.devices,
                honorMuted: true,
                contributesAudio: true,
            },
            { kind: 'set-track-output', trackId: FIXTURE_TRACK_ID, target: { kind: 'master' } },
            {
                kind: 'schedule-clip',
                playback: {
                    trackId: FIXTURE_TRACK_ID,
                    source: { sourceId: 'fixture-take', buffer: fixture.material as unknown as AudioBuffer },
                    startTime: fixture.startSec,
                    sourceOffsetSeconds: fixture.bufferOffsetSec,
                    durationSeconds: fixture.playDurationSec,
                    playbackRate: fixture.playbackRate,
                    gain: fixture.clipGain,
                    fade: {
                        fadeIn: { reachesFullAt: fixture.fadeInReachesFullAt },
                        fadeOut: { beginsAt: fixture.fadeOutBeginsAt },
                        microFadeSeconds: MICRO_FADE_SECONDS,
                    },
                },
            },
        ],
    });

    if (result.application !== 'applied') {
        throw new Error(`contract backend refused the clip batch: ${JSON.stringify(result)}`);
    }
    const report = result.reports.find((entry) => entry.id === FIXTURE_TRACK_ID);
    if (!report) {
        throw new Error('contract backend applied a strip command and reported no strip');
    }

    const buffer = await context.startRendering();
    return { buffer, builtDeviceIds: [...report.deviceIds] };
}

type ClipMisread = (fixture: ClipFixture) => ClipFixture;

async function nullTestClip(input: { fixture: ClipFixture; misread?: ClipMisread }): Promise<NullTestResult> {
    const asked = (input.misread ?? ((fixture: ClipFixture) => fixture))(input.fixture);
    const reference = await renderClipOffline(input.fixture);
    const contract = await renderClipThroughContract(asked);
    const expected = input.fixture.strip.devices.filter((entry) => !entry.bypassed).map((entry) => entry.id);
    assertDevicesBuilt({ leg: 'offline clip leg', expected, built: reference.builtDeviceIds });
    assertDevicesBuilt({ leg: 'contract clip leg', expected, built: contract.builtDeviceIds });
    return nullTest({ a: reference.buffer, b: contract.buffer });
}

/** Every one measured against a −18.49 dBFS signal. */
const CLIP_DIVERGENCES: Array<{ name: string; misread: ClipMisread; band: ResidualBand }> = [
    {
        // Measured −72.47 dBFS.
        name: 'takes a clip gain one part in five hundred hot',
        misread: (fixture) => ({ ...fixture, clipGain: fixture.clipGain * 1.002 }),
        band: 'inaudible',
    },
    {
        // A tenth of a millisecond — under five frames at 48 kHz — on a 60 ms
        // fade, measured −75.12 dBFS. The number is small on purpose: a fade
        // edge that arrives a whole millisecond late is a defect anyone would
        // find, and proving the seam catches *that* would say nothing about its
        // resolution. This says the fade's absolute times cross the seam intact.
        name: 'reaches the top of a user fade in a tenth of a millisecond late',
        misread: (fixture) => ({ ...fixture, fadeInReachesFullAt: fixture.fadeInReachesFullAt + 0.0001 }),
        band: 'inaudible',
    },
    {
        // Measured −76.90 dBFS. Lower than the fade in's for the reason the
        // arithmetic gives: the same tenth of a millisecond is a smaller
        // fraction of the 80 ms fade out, so it moves the envelope less.
        name: 'begins a user fade out a tenth of a millisecond early',
        misread: (fixture) => ({ ...fixture, fadeOutBeginsAt: fixture.fadeOutBeginsAt - 0.0001 }),
        band: 'inaudible',
    },
];

describe('live/offline null test — a scheduled clip and its fades', () => {
    it('nulls a clip with a user fade in and fade out through the contract-backed backend', async () => {
        expectNull(await nullTestClip({ fixture: CLIP_FIXTURE }));
    });

    /**
     * The clip has to actually fade, or every null above is taken between two
     * renders of a rectangular window and the fade fields are decoration.
     *
     * Measured at the head: the first frames of a 60 ms fade in sit far below
     * the clip's steady level, and a scheduler that ignored `fadeIn` would put
     * full level there.
     */
    it('renders the fade in as a fade rather than an edge', async () => {
        const rendered = await renderClipThroughContract(CLIP_FIXTURE);
        const channel = rendered.buffer.getChannelData(0);
        const startFrame = Math.round(CLIP_FIXTURE.startSec * SAMPLE_RATE);
        const fadeSpan = Math.round((CLIP_FIXTURE.fadeInReachesFullAt - CLIP_FIXTURE.startSec) * SAMPLE_RATE);

        function peakBetween(from: number, to: number): number {
            let peak = 0;
            for (let frame = from; frame < to; frame++) {
                peak = Math.max(peak, Math.abs(channel[frame] ?? 0));
            }
            return peak;
        }

        const head = peakBetween(startFrame, startFrame + Math.round(fadeSpan * 0.1));
        const settled = peakBetween(startFrame + fadeSpan, startFrame + fadeSpan * 2);

        expect(settled).toBeGreaterThan(0);
        // A tenth of the way into the fade the envelope is at a tenth of level.
        // A rectangular window would put these two within rounding of each other.
        expect(head).toBeLessThan(settled * 0.35);
    });

    it.each(CLIP_DIVERGENCES)('reds when the contract-backed backend $name', async (divergence) => {
        expectPerturbedRed({
            result: await nullTestClip({ fixture: CLIP_FIXTURE, misread: divergence.misread }),
            band: divergence.band,
            leg: 'clip leg',
        });

        expectNull(await nullTestClip({ fixture: CLIP_FIXTURE }));
    });
});

describe('live/offline null test — a stretched clip', () => {
    it.each(STRETCHED_CLIP_FIXTURES)('nulls $strip.name through the contract-backed backend', async (fixture) => {
        expectNull(await nullTestClip({ fixture }));
    });

    /**
     * The nulls above are only worth their ink if the fixtures occupy the
     * destination span the contract promised them. Both legs run one body, so
     * a body that read `durationSeconds` in the source's own time would shorten
     * or lengthen *both* renders and null anyway — the span is therefore
     * measured against the rendered frames rather than inferred from a null.
     *
     * The window is the last tenth of a second before the clip's end: it is
     * inside the region for every rate, and it is past where a source-seconds
     * reading would have stopped a sped-up clip.
     */
    it.each(STRETCHED_CLIP_FIXTURES)(
        'sounds $strip.name for its destination span, not its source span',
        async (fixture) => {
            const rendered = await renderClipThroughContract(fixture);
            const channel = rendered.buffer.getChannelData(0);
            const endSec = fixture.startSec + fixture.playDurationSec;

            function peakBetween(fromSec: number, toSec: number): number {
                let peak = 0;
                for (let frame = Math.round(fromSec * SAMPLE_RATE); frame < Math.round(toSec * SAMPLE_RATE); frame++) {
                    peak = Math.max(peak, Math.abs(channel[frame] ?? 0));
                }
                return peak;
            }

            const settled = peakBetween(fixture.fadeInReachesFullAt, fixture.fadeInReachesFullAt + 0.05);
            expect(settled).toBeGreaterThan(0);
            expect(peakBetween(endSec - 0.1, endSec - 0.05)).toBeGreaterThan(settled * 0.2);
            // And it stops where the destination span ends. Bounded rather than
            // zeroed because the strip's filter rings past its last input.
            expect(peakBetween(endSec + 0.01, RENDER_FRAMES / SAMPLE_RATE)).toBeLessThan(settled * 0.001);
        }
    );

    /**
     * The divergences this fixture exists for. A backend that drops the rate,
     * or states the duration in the wrong frame of reference, moves which
     * frames of the material land where — and at rate 1 both misreads are
     * invisible, which is why they are asked here and not above.
     */
    it.each([
        {
            name: 'plays the clip at unmodified rate',
            misread: (fixture: ClipFixture): ClipFixture => ({ ...fixture, playbackRate: 1 }),
        },
        {
            name: "reads the clip's duration in the source's own time",
            misread: (fixture: ClipFixture): ClipFixture => ({
                ...fixture,
                playDurationSec: fixture.playDurationSec * fixture.playbackRate,
            }),
        },
    ])('reds when the contract-backed backend $name', async (divergence) => {
        expectPerturbedRed({
            result: await nullTestClip({ fixture: SLOWED_CLIP_FIXTURE, misread: divergence.misread }),
            band: 'audible',
            leg: 'stretched clip leg',
        });

        expectNull(await nullTestClip({ fixture: SLOWED_CLIP_FIXTURE }));
    });
});
