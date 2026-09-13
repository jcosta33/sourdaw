import { describe, it, expect, vi } from 'vitest';

import { dbToGain } from '#/utils/audioLevelLaw';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { resolveDeviceParamTargets } from '../../../services/deviceResolution';
import { createOfflineDeviceNode, type OfflineDeviceNode } from '../../deviceNodeFactory';
import { WebAudioDeviceStrategy } from '../../deviceStrategy/WebAudioDeviceStrategy';

import { scheduleTrackAutomationFixture } from './scheduleTrackAutomationFixture';

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
    return { deviceId, deviceType, strategy: new WebAudioDeviceStrategy(node, deviceType) };
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

    it('schedules limiter release in seconds and ceiling in linear gain', () => {
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

        // Ceiling -0.3 dB should schedule dbToGain(-0.3) ≈ 0.96605, not -0.3
        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    parameterId: 'device-1:lim-ceiling',
                    minValue: -24,
                    maxValue: 0,
                    points: [{ beat: 0, value: -0.3, curve: 'linear', tension: 0 }],
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

        expect(ceiling.gain.setValueAtTime).toHaveBeenCalledWith(expect.closeTo(dbToGain(-0.3), 5), 0);
    });

    it('resolves targets with correct scale and transform definitions', () => {
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
        expect(gainTargets[0]?.transform).toBeDefined();
        expect(gainTargets[0]?.transform?.(0)).toBe(1.0);
        expect(gainTargets[0]?.transform?.(-6)).toBeCloseTo(dbToGain(-6), 5);

        const attackTargets = resolveDeviceParamTargets('builtin-compressor', 'comp-attack', compNode);
        expect(attackTargets[0]?.scale).toBe(1 / 1000);

        const releaseTargets = resolveDeviceParamTargets('builtin-compressor', 'comp-release', compNode);
        expect(releaseTargets[0]?.scale).toBe(1 / 1000);

        const makeupTargets = resolveDeviceParamTargets('builtin-compressor', 'comp-makeup', compNode);
        expect(makeupTargets[0]?.transform).toBeDefined();
        expect(makeupTargets[0]?.transform?.(0)).toBe(1.0);

        const limReleaseTargets = resolveDeviceParamTargets('builtin-limiter', 'lim-release', limNode);
        expect(limReleaseTargets[0]?.scale).toBe(1 / 1000);

        const limCeilingTargets = resolveDeviceParamTargets('builtin-limiter', 'lim-ceiling', limNode);
        expect(limCeilingTargets[0]?.transform).toBeDefined();
        expect(limCeilingTargets[0]?.transform?.(0)).toBe(1.0);
    });
});
