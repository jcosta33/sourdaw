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
 * Web Audio itself is modelled — see `nullTestRenderHarness.ts` for exactly
 * what that model does and does not cover, and why the model cancels out of a
 * subtraction where both legs run through it.
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
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Device } from '../../../models/TrackViewTypes';

import {
    createFixtureSignal,
    createNullTestRenderHarness,
    nullTest,
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
const { createOfflineTrackStrip } = await import('../createOfflineTrackStrip');

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

function newContext(): HarnessRenderContext {
    return new harness.OfflineAudioContext(2, RENDER_FRAMES, SAMPLE_RATE);
}

/**
 * The live leg: a real `TrackNode`, driven by the real live writers.
 *
 * The device parameters go in one at a time through `updateParam`, because that
 * is how they arrive live — `WebAudioEngine.updateDeviceParam` forwards a single
 * `(deviceId, paramId, value)` per store change. The offline leg hands
 * `applyParams` the whole `parameterValues` record at construction. Those are
 * two different call patterns into the same appliers, and whether they land on
 * the same graph is part of what is being measured.
 */
async function renderLive(fixture: TrackFixture): Promise<RenderedBuffer> {
    const context = newContext();
    const master = context.createGain() as { gain: { value: number }; connect: (to: unknown) => unknown };
    master.gain.value = 1;
    master.connect(context.destination);

    const trackNode = new TrackNode('track-1', {
        context: context as unknown as AudioContext,
        masterGainNode: master as unknown as GainNode,
        getBusGainNode: () => undefined,
        getTrackGainNode: () => undefined,
        getSendsForTrack: () => [],
        pendingDevicePromises: new Set<Promise<unknown>>(),
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

    const source = context.createSignalSource(createFixtureSignal({ frames: RENDER_FRAMES, sampleRate: SAMPLE_RATE }));
    source.connect(trackNode.strip.gainNode);
    return await context.startRendering();
}

/** The offline leg: what an export builds, through the production strip builder. */
async function renderOffline(fixture: TrackFixture): Promise<RenderedBuffer> {
    const context = newContext();
    const master = context.createGain() as { gain: { value: number }; connect: (to: unknown) => unknown };
    master.gain.value = 1;
    master.connect(context.destination);

    const strip = await createOfflineTrackStrip(context as unknown as OfflineAudioContext, {
        name: fixture.name,
        gain: fixture.gain,
        muted: fixture.muted,
        pan: fixture.pan,
        devices: fixture.devices,
    });
    (strip.outputNode as unknown as { connect: (to: unknown) => unknown }).connect(master);

    const source = context.createSignalSource(createFixtureSignal({ frames: RENDER_FRAMES, sampleRate: SAMPLE_RATE }));
    source.connect(strip.inputNode);
    return await context.startRendering();
}

async function nullTestFixture(fixture: TrackFixture): Promise<NullTestResult> {
    const live = await renderLive(fixture);
    const offline = await renderOffline(fixture);
    return nullTest({ a: live, b: offline });
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

describe('live/offline null test — the strip itself', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('nulls a bare strip at unity', async () => {
        expectNull(await nullTestFixture({ ...BASE_TRACK, gain: 1 }));
    });

    it('nulls a strip whose fader is not at unity', async () => {
        expectNull(await nullTestFixture({ ...BASE_TRACK, gain: 0.37 }));
    });

    it('nulls a strip whose stored gain sits above the fader ceiling', async () => {
        // FX-7: live clamps in `TrackNode.setGain`, offline in
        // `createOfflineTrackStrip`. A project carrying gain > 1 — importers and
        // older files do — is where the two laws can part.
        expectNull(await nullTestFixture({ ...BASE_TRACK, gain: 1.8 }));
    });

    it('nulls a panned strip', async () => {
        expectNull(await nullTestFixture({ ...BASE_TRACK, pan: -31 }));
    });
});

describe('live/offline null test — deterministic device chains', () => {
    it('nulls a gain device', async () => {
        expectNull(
            await nullTestFixture({
                ...BASE_TRACK,
                devices: [device({ id: 'd-gain', type: 'builtin-gain', parameterValues: { 'gain-level': -4.5 } })],
            })
        );
    });

    it('nulls a filter with a non-default cutoff, resonance and type', async () => {
        expectNull(
            await nullTestFixture({
                ...BASE_TRACK,
                devices: [
                    device({
                        id: 'd-filter',
                        type: 'builtin-filter',
                        // Deliberately none of the factory defaults (lowpass,
                        // 1000 Hz, Q 1): a chain rendered from the constructor's
                        // own state instead of the project's must not null.
                        parameterValues: { 'filter-cutoff': 2400, 'filter-resonance': 6.5, 'filter-type': 1 },
                    }),
                ],
            })
        );
    });

    it('nulls a three-band EQ', async () => {
        expectNull(
            await nullTestFixture({
                ...BASE_TRACK,
                devices: [
                    device({
                        id: 'd-eq',
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
                ],
            })
        );
    });

    it('nulls a distortion, whose graph forks dry and wet', async () => {
        // The only fixture device that is not a single node: a parallel
        // dry/wet fork whose summing point is inside the device. If the two
        // paths built its internals in a different order the residual shows up
        // here and nowhere else.
        expectNull(
            await nullTestFixture({
                ...BASE_TRACK,
                devices: [
                    device({
                        id: 'd-dist',
                        type: 'builtin-distortion',
                        parameterValues: {
                            'dist-drive': 55,
                            'dist-tone': 2600,
                            'dist-output': -2.5,
                            'dist-mix': 0.65,
                        },
                    }),
                ],
            })
        );
    });

    it('nulls a multi-device chain in project order', async () => {
        expectNull(
            await nullTestFixture({
                ...BASE_TRACK,
                gain: 0.62,
                pan: 18,
                devices: [
                    device({ id: 'd-1', type: 'builtin-gain', parameterValues: { 'gain-level': -3 } }),
                    device({
                        id: 'd-2',
                        type: 'builtin-filter',
                        parameterValues: { 'filter-cutoff': 3200, 'filter-resonance': 2 },
                    }),
                    device({
                        id: 'd-3',
                        type: 'builtin-distortion',
                        parameterValues: { 'dist-drive': 30, 'dist-mix': 0.4 },
                    }),
                    device({
                        id: 'd-4',
                        type: 'builtin-eq',
                        parameterValues: { 'eq-mid-gain': -6, 'eq-mid-freq': 1400 },
                    }),
                ],
            })
        );
    });

    it('nulls a chain with a bypassed device in the middle', async () => {
        expectNull(
            await nullTestFixture({
                ...BASE_TRACK,
                devices: [
                    device({ id: 'd-1', type: 'builtin-gain', parameterValues: { 'gain-level': -3 } }),
                    device({
                        id: 'd-2',
                        type: 'builtin-filter',
                        parameterValues: { 'filter-cutoff': 800 },
                        bypassed: true,
                    }),
                    device({ id: 'd-3', type: 'builtin-gain', parameterValues: { 'gain-level': -2 } }),
                ],
            })
        );
    });
});

describe('live/offline null test — the instrument can fail', () => {
    /**
     * ADR 0015 rule 1: a guard ships with the mutation that reds it, and rule 2
     * wants that mutation committed rather than run once.
     *
     * The break is chosen to be *representative*, not convenient. A hand-injected
     * DC offset would prove only that subtraction works. What is injected here is
     * the shipped defect this whole phase exists to find: **the offline path
     * building a device from its constructor's own defaults instead of from the
     * project's stored configuration.**
     *
     * That is not a hypothetical. It is the Toaster finding verbatim — the export
     * rendered `ToasterEngine::new`'s kit rather than the user's pads — and the
     * Levain finding, where the offline chain built an engine with no sample
     * zones because "offline construction and live construction are two
     * registries, not one builder with a flag" (`buildDeviceChain`'s own comment).
     * The seam here is the same one: `createWebAudioDevice` is reached only by
     * the offline registry, and dropping its `applyParams` call is exactly the
     * single line that would reintroduce that class of bug for builtin devices.
     *
     * The mutation: `WebAudioDeviceStrategy.createWebAudioDevice` stops applying
     * `device.parameterValues`. The assertion that reds is the
     * `toBeLessThanOrEqual(RESIDUAL_BUDGET_DBFS)` in `expectNull`.
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
        const result = nullTest({ a: live, b: broken });

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
        const correct = nullTest({ a: live, b: await renderOffline(fixture) });
        expect(correct.residualPeakDbfs).toBeLessThanOrEqual(RESIDUAL_BUDGET_DBFS);
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
        const result = nullTest({ a: live, b: offline });

        // Measured −69.1 dBFS: over the budget, and still 9 dB below the point
        // AC-1 calls audible. The budget catches divergences nobody could hear.
        expect(result.residualPeakDbfs).toBeGreaterThan(RESIDUAL_BUDGET_DBFS);
        expect(result.residualPeakDbfs).toBeLessThan(RESIDUAL_DEFECT_DBFS);
    });

    it('sees a filter cutoff divergence of 1 Hz in 2400', async () => {
        const live = await renderLive({
            ...BASE_TRACK,
            devices: [device({ id: 'd-f', type: 'builtin-filter', parameterValues: { 'filter-cutoff': 2400 } })],
        });
        const offline = await renderOffline({
            ...BASE_TRACK,
            devices: [device({ id: 'd-f', type: 'builtin-filter', parameterValues: { 'filter-cutoff': 2401 } })],
        });
        const result = nullTest({ a: live, b: offline });

        // Measured −84.7 dBFS. Four hundredths of a percent of the cutoff is
        // over budget, which is what makes the clean nulls above worth having.
        expect(result.residualPeakDbfs).toBeGreaterThan(RESIDUAL_BUDGET_DBFS);
    });

    it('sees a pan divergence of one fifty-thousandth of full scale', async () => {
        const live = await renderLive({ ...BASE_TRACK, pan: 20 });
        const offline = await renderOffline({ ...BASE_TRACK, pan: 20.01 });
        const result = nullTest({ a: live, b: offline });

        // Measured −83.0 dBFS.
        expect(result.residualPeakDbfs).toBeGreaterThan(RESIDUAL_BUDGET_DBFS);
    });

    /**
     * The other way a clean null goes hollow: a fixture whose devices do not
     * actually shape the signal. Both legs would agree about nothing. Each
     * fixture device must move the render measurably away from a bare strip.
     */
    it('renders every fixture device to something audibly unlike a bare strip', async () => {
        const bare = await renderOffline({ ...BASE_TRACK, gain: 1 });
        const chains: Array<[string, Device]> = [
            ['gain', device({ id: 'd', type: 'builtin-gain', parameterValues: { 'gain-level': -4.5 } })],
            [
                'filter',
                device({
                    id: 'd',
                    type: 'builtin-filter',
                    parameterValues: { 'filter-cutoff': 2400, 'filter-resonance': 6.5, 'filter-type': 1 },
                }),
            ],
            [
                'eq',
                device({
                    id: 'd',
                    type: 'builtin-eq',
                    parameterValues: { 'eq-low-gain': 4.5, 'eq-mid-gain': -3, 'eq-high-gain': 2 },
                }),
            ],
            [
                'distortion',
                device({
                    id: 'd',
                    type: 'builtin-distortion',
                    parameterValues: { 'dist-drive': 55, 'dist-tone': 2600, 'dist-mix': 0.65 },
                }),
            ],
        ];

        for (const [label, entry] of chains) {
            const rendered = await renderOffline({ ...BASE_TRACK, gain: 1, devices: [entry] });
            const difference = nullTest({ a: rendered, b: bare });
            expect(
                difference.residualPeakDbfs,
                `${label} changed the render by too little to test with`
            ).toBeGreaterThan(-25);
        }
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
            devices: [
                device({
                    id: 'd-1',
                    type: 'builtin-filter',
                    parameterValues: { 'filter-cutoff': 3200, 'filter-resonance': 2 },
                }),
                device({ id: 'd-2', type: 'builtin-distortion', parameterValues: { 'dist-drive': 30 } }),
            ],
        };

        const first = await renderLive(fixture);
        const second = await renderLive(fixture);
        const repeat = nullTest({ a: first, b: second });

        expect(repeat.signalPeakDbfs).toBeGreaterThan(-40);
        expect(repeat.residualPeakDbfs).toBe(-Infinity);
    });
});
