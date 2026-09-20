import { describe, it, expect, vi } from 'vitest';

import { dbToGain } from '#/utils/audioLevelLaw';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { resolveDeviceCurveWriteTargets, resolveDeviceParamTargets } from '../../../services/deviceResolution';
import { createOfflineDeviceNode, type OfflineDeviceNode } from '../../deviceNodeFactory';
import { makeCeilingClipCurve } from '../../devices/dynamics/makeCeilingClipCurve';
import { WebAudioDeviceStrategy } from '../../deviceStrategy/WebAudioDeviceStrategy';

import {
    descriptorFixtureDeviceLaw,
    SHIPPING_GRAIN_SLEW_TICK_SECONDS,
    scheduleTrackAutomationFixture,
} from './scheduleTrackAutomationFixture';

/**
 * The frame scheduler double: records every `(time, call)` and exposes the
 * calls so a case can run them the way the real scheduler's suspend handler
 * does. Registering them without running them is what a silent drop looks like.
 */
function makeFrameScheduler() {
    const calls: { time: number | undefined; run: () => void }[] = [];
    return {
        calls,
        scheduleFrame: (time: number | undefined, call: () => void): void => {
            calls.push({ time, run: call });
        },
    };
}

function makeParam() {
    return {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
    };
}

function makeLane(overrides: Partial<AutomationLane>): AutomationLane {
    return {
        id: overrides.id ?? 'lane-1',
        trackId: overrides.trackId ?? 'track-1',
        clipId: overrides.clipId,
        parameterId: overrides.parameterId ?? 'device-1:gain-level',
        parameterName: overrides.parameterName ?? 'Gain Level',
        points: overrides.points ?? [],
        enabled: overrides.enabled ?? true,
        minValue: overrides.minValue ?? -60,
        maxValue: overrides.maxValue ?? 12,
    };
}

function webAudioEntry(deviceId: string, deviceType: string, node: OfflineDeviceNode) {
    return { deviceId, deviceType, contributesAudio: true, strategy: new WebAudioDeviceStrategy(node, deviceType) };
}

describe('builtin device automation units reproduction (#3738)', () => {
    it('schedules builtin-gain gain-level using dB-to-linear conversion instead of raw dB', () => {
        const context = createMockAudioContext();
        const deviceNode = createOfflineDeviceNode({
            context: asBaseAudioContext(context),
            deviceType: 'builtin-gain',
        });
        if (!deviceNode) {
            throw new Error('Expected builtin-gain factory');
        }

        const gainParam = (deviceNode.nodes[0] as GainNode).gain;

        // Constant 0 dB should schedule 1.0 linear gain (unity), not 0.0 (silence)
        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    parameterId: 'device-1:gain-level',
                    minValue: -60,
                    maxValue: 12,
                    points: [{ beat: 0, value: 0, curve: 'linear', tension: 0 }],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [webAudioEntry('device-1', 'builtin-gain', deviceNode)],
            durationSeconds: 5,
            defaultTempo: 120,
            changes: [],
        });

        expect(gainParam.setValueAtTime).toHaveBeenCalledWith(1.0, 0);

        vi.mocked(gainParam.setValueAtTime).mockClear();

        // -6 dB should schedule dbToGain(-6) ≈ 0.501187, not -6.0
        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    parameterId: 'device-1:gain-level',
                    minValue: -60,
                    maxValue: 12,
                    points: [{ beat: 0, value: -6, curve: 'linear', tension: 0 }],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [webAudioEntry('device-1', 'builtin-gain', deviceNode)],
            durationSeconds: 5,
            defaultTempo: 120,
            changes: [],
        });

        expect(gainParam.setValueAtTime).toHaveBeenCalledWith(expect.closeTo(dbToGain(-6), 5), 0);
    });

    it('schedules compressor attack and release in seconds (ms / 1000) and makeup in linear gain', () => {
        const context = createMockAudioContext();
        const deviceNode = createOfflineDeviceNode({
            context: asBaseAudioContext(context),
            deviceType: 'builtin-compressor',
        });
        if (!deviceNode) {
            throw new Error('Expected builtin-compressor factory');
        }

        const comp = deviceNode.nodes[0] as DynamicsCompressorNode;
        const makeup = deviceNode.nodes[1] as GainNode;

        // Attack 10ms should schedule 0.010s, not 10s
        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    parameterId: 'device-1:comp-attack',
                    minValue: 1,
                    maxValue: 500,
                    points: [{ beat: 0, value: 10, curve: 'linear', tension: 0 }],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [webAudioEntry('device-1', 'builtin-compressor', deviceNode)],
            durationSeconds: 5,
            defaultTempo: 120,
            changes: [],
        });

        expect(comp.attack.setValueAtTime).toHaveBeenCalledWith(0.01, 0);

        // Release 100ms should schedule 0.100s, not 100s
        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    parameterId: 'device-1:comp-release',
                    minValue: 10,
                    maxValue: 1000,
                    points: [{ beat: 0, value: 100, curve: 'linear', tension: 0 }],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [webAudioEntry('device-1', 'builtin-compressor', deviceNode)],
            durationSeconds: 5,
            defaultTempo: 120,
            changes: [],
        });

        expect(comp.release.setValueAtTime).toHaveBeenCalledWith(0.1, 0);

        // Makeup 6 dB should schedule dbToGain(6) ≈ 1.99526, not 6
        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    parameterId: 'device-1:comp-makeup',
                    minValue: -24,
                    maxValue: 24,
                    points: [{ beat: 0, value: 6, curve: 'linear', tension: 0 }],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [webAudioEntry('device-1', 'builtin-compressor', deviceNode)],
            durationSeconds: 5,
            defaultTempo: 120,
            changes: [],
        });

        expect(makeup.gain.setValueAtTime).toHaveBeenCalledWith(expect.closeTo(dbToGain(6), 5), 0);
    });

    it('schedules limiter release in seconds and writes the ceiling curve at every automation point', () => {
        const context = createMockAudioContext();
        const deviceNode = createOfflineDeviceNode({
            context: asBaseAudioContext(context),
            deviceType: 'builtin-limiter',
        });
        if (!deviceNode) {
            throw new Error('Expected builtin-limiter factory');
        }

        const comp = deviceNode.nodes[0] as DynamicsCompressorNode;
        const ceiling = deviceNode.nodes[1] as GainNode;
        const clipper = deviceNode.nodes[2] as unknown as { curve: Float32Array | null };

        // Release 100ms should schedule 0.100s, not 100s
        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    parameterId: 'device-1:lim-release',
                    minValue: 10,
                    maxValue: 1000,
                    points: [{ beat: 0, value: 100, curve: 'linear', tension: 0 }],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [webAudioEntry('device-1', 'builtin-limiter', deviceNode)],
            durationSeconds: 5,
            defaultTempo: 120,
            changes: [],
        });

        expect(comp.release.setValueAtTime).toHaveBeenCalledWith(0.1, 0);

        // The ceiling has no AudioParam, so the lane is written at the frames
        // its compiled points fall on. The lane declares -60..12 while the
        // descriptor declares -3..0, so the -5 dB point proves the device law's
        // clamp runs: the write lands on the descriptor's -3, not 3 dB louder.
        const { calls, scheduleFrame } = makeFrameScheduler();
        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    parameterId: 'device-1:lim-ceiling',
                    minValue: -60,
                    maxValue: 12,
                    points: [
                        { beat: 0, value: -0.3, curve: 'linear', tension: 0 },
                        { beat: 4, value: -5, curve: 'linear', tension: 0 },
                    ],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: { gain: makeParam() } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [webAudioEntry('device-1', 'builtin-limiter', deviceNode)],
            // The descriptor admits the ceiling; the binding is what could not
            // answer for it before #4437.
            deviceParameterLaw: descriptorFixtureDeviceLaw(),
            durationSeconds: 5,
            defaultTempo: 120,
            changes: [],
            scheduleFrame,
        });

        // The ceiling lane is device-slewed like every other device parameter,
        // so its compiled points ride the 10 ms slew grid across the 2 s ramp
        // and on to the settle hold rather than landing as two discrete writes
        // at the point times.
        expect(calls.length).toBeGreaterThan(2);
        expect(calls[0]!.time).toBe(0);
        expect(calls[1]!.time).toBeCloseTo(SHIPPING_GRAIN_SLEW_TICK_SECONDS, 9);
        expect(calls.at(-1)!.time!).toBeGreaterThan(2);
        for (const call of calls) {
            call.run();
        }

        // Both halves of the write: the gain trim and the rebuilt cap curve,
        // through the same law the static applier uses. A static-only write
        // leaves the factory curve and reds the last assertion.
        expect(ceiling.gain.value).toBeCloseTo(dbToGain(-3), 12);
        expect(clipper.curve).toEqual(makeCeilingClipCurve(dbToGain(-3)));
        expect(clipper.curve).not.toEqual(makeCeilingClipCurve(dbToGain(-0.3)));
    });

    it('resolves targets with correct scale and convert definitions', () => {
        const context = createMockAudioContext();
        const gainNode = createOfflineDeviceNode({
            context: asBaseAudioContext(context),
            deviceType: 'builtin-gain',
        })!;
        const compNode = createOfflineDeviceNode({
            context: asBaseAudioContext(context),
            deviceType: 'builtin-compressor',
        })!;
        const limNode = createOfflineDeviceNode({
            context: asBaseAudioContext(context),
            deviceType: 'builtin-limiter',
        })!;

        const gainTargets = resolveDeviceParamTargets('builtin-gain', 'gain-level', gainNode);
        expect(gainTargets[0]?.convert).toBeDefined();
        expect(gainTargets[0]?.convert?.(0)).toBe(1.0);
        expect(gainTargets[0]?.convert?.(-6)).toBeCloseTo(dbToGain(-6), 5);

        const attackTargets = resolveDeviceParamTargets('builtin-compressor', 'comp-attack', compNode);
        expect(attackTargets[0]?.scale).toBe(1 / 1000);

        const releaseTargets = resolveDeviceParamTargets('builtin-compressor', 'comp-release', compNode);
        expect(releaseTargets[0]?.scale).toBe(1 / 1000);

        const makeupTargets = resolveDeviceParamTargets('builtin-compressor', 'comp-makeup', compNode);
        expect(makeupTargets[0]?.convert).toBeDefined();
        expect(makeupTargets[0]?.convert?.(0)).toBe(1.0);

        const limReleaseTargets = resolveDeviceParamTargets('builtin-limiter', 'lim-release', limNode);
        expect(limReleaseTargets[0]?.scale).toBe(1 / 1000);

        // The ceiling carries no AudioParam target: the cap is the clipper's
        // rebuilt WaveShaper curve, so it resolves as a curve write instead.
        expect(resolveDeviceParamTargets('builtin-limiter', 'lim-ceiling', limNode)).toHaveLength(0);
        const ceilingTargets = resolveDeviceCurveWriteTargets('builtin-limiter', 'lim-ceiling', limNode);
        expect(ceilingTargets?.ceiling).toBe(limNode.namedNodes?.ceiling);
        expect(ceilingTargets?.clipper).toBe(limNode.namedNodes?.clipper);
        expect(resolveDeviceCurveWriteTargets('builtin-limiter', 'lim-threshold', limNode)).toBeNull();
        expect(resolveDeviceCurveWriteTargets('builtin-limiter', 'lim-release', limNode)).toBeNull();
    });
});
