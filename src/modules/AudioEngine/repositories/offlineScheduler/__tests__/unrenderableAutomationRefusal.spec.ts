import { describe, expect, it, vi } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { createOfflineDeviceNode } from '../../deviceNodeFactory';
import { WebAudioDeviceStrategy } from '../../deviceStrategy/WebAudioDeviceStrategy';
import { unrenderableAutomationRefusal } from '../refuseUnrenderableAutomation';

import {
    descriptorFixtureDeviceLaw,
    scheduleTrackAutomationFixture,
    type ScheduleTrackAutomationFixtureInput,
} from './scheduleTrackAutomationFixture';

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
        parameterId: overrides.parameterId ?? 'gain',
        parameterName: overrides.parameterName ?? 'Gain',
        points: overrides.points ?? [],
        enabled: overrides.enabled ?? true,
        minValue: overrides.minValue ?? 0,
        maxValue: overrides.maxValue ?? 1,
    };
}

/**
 * The limiter as the offline chain builds it: a real node whose strategy
 * resolves no binding for any parameter. The ceiling is the unbound one — its
 * cap is the clipper's rebuilt WaveShaper curve, not an AudioParam (#3736).
 */
function limiterEntry(contributesAudio = true) {
    const node = createOfflineDeviceNode({
        context: asBaseAudioContext(createMockAudioContext()),
        deviceType: 'builtin-limiter',
    });
    if (!node) {
        throw new Error('expected a builtin-limiter offline node');
    }
    return {
        deviceId: 'limiter-1',
        deviceType: 'builtin-limiter',
        contributesAudio,
        strategy: new WebAudioDeviceStrategy(node, 'builtin-limiter'),
    };
}

const CEILING_LANE = makeLane({
    id: 'lane-ceiling',
    parameterId: 'limiter-1:lim-ceiling',
    parameterName: 'Ceiling',
    minValue: -3,
    maxValue: 0,
    points: [{ beat: 0, value: -1, curve: 'linear', tension: 0 }],
});

function schedule(
    lanes: AutomationLane[],
    deviceEntries: ScheduleTrackAutomationFixtureInput['deviceEntries']
): { gain: ReturnType<typeof makeParam> } {
    const gain = makeParam();
    scheduleTrackAutomationFixture({
        lanes,
        trackId: 'track-1',
        trackGainNode: { gain } as unknown as GainNode,
        trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
        deviceEntries,
        // The fixture default admits only a parameter that already resolves a
        // binding, which excludes the ceiling at the gate. This spec is about
        // what happens after admission, so it states the descriptor law the
        // live path runs.
        deviceParameterLaw: descriptorFixtureDeviceLaw(),
        durationSeconds: 10,
        defaultTempo: 120,
        changes: [],
    });
    return { gain };
}

describe('unrenderableAutomationRefusal', () => {
    it('names the limiter and its ceiling, and tells the musician what to change', () => {
        const refusal = unrenderableAutomationRefusal({
            deviceType: 'builtin-limiter',
            parameterId: 'lim-ceiling',
            contributesAudio: true,
        });

        expect(refusal).toContain('limiter ceiling');
        expect(refusal).toMatch(/clipping curve/i);
        expect(refusal).toMatch(/remove the ceiling automation lane, disable it, or set a static ceiling/i);
    });

    it('stays silent for the same ceiling on a strip that cannot reach the print', () => {
        expect(
            unrenderableAutomationRefusal({
                deviceType: 'builtin-limiter',
                parameterId: 'lim-ceiling',
                contributesAudio: false,
            })
        ).toBeNull();
    });

    it.each(['lim-threshold', 'lim-release'])('stays silent for %s, which does resolve a binding', (parameterId) => {
        expect(
            unrenderableAutomationRefusal({
                deviceType: 'builtin-limiter',
                parameterId,
                contributesAudio: true,
            })
        ).toBeNull();
    });

    it('stays silent for a ceiling-named parameter on a device that does not carry one', () => {
        expect(
            unrenderableAutomationRefusal({
                deviceType: 'builtin-compressor',
                parameterId: 'lim-ceiling',
                contributesAudio: true,
            })
        ).toBeNull();
    });
});

describe('scheduleTrackAutomation — an unrenderable device-parameter lane (#4424)', () => {
    it('refuses a contributing ceiling lane instead of silently keeping the static ceiling', () => {
        expect(() => schedule([CEILING_LANE], [limiterEntry()])).toThrow(/limiter ceiling/i);
    });

    it('drops the same lane without refusing when the strip does not contribute audio', () => {
        const { gain } = schedule([CEILING_LANE], [limiterEntry(false)]);

        expect(gain.setValueAtTime).not.toHaveBeenCalled();
    });

    it('still schedules a lane whose parameter does resolve a binding', () => {
        const node = createOfflineDeviceNode({
            context: asBaseAudioContext(createMockAudioContext()),
            deviceType: 'builtin-gain',
        });
        if (!node) {
            throw new Error('expected a builtin-gain offline node');
        }
        const gainDeviceParam = (node.nodes[0] as unknown as { gain: ReturnType<typeof makeParam> }).gain;

        schedule(
            [
                makeLane({
                    parameterId: 'device-1:gain-level',
                    minValue: -60,
                    maxValue: 6,
                    points: [{ beat: 0, value: -6, curve: 'linear', tension: 0 }],
                }),
            ],
            [
                {
                    deviceId: 'device-1',
                    deviceType: 'builtin-gain',
                    strategy: new WebAudioDeviceStrategy(node, 'builtin-gain'),
                },
            ]
        );

        expect(gainDeviceParam.setValueAtTime).toHaveBeenCalled();
    });

    it('still schedules a limiter release lane, which does resolve a binding', () => {
        const node = createOfflineDeviceNode({
            context: asBaseAudioContext(createMockAudioContext()),
            deviceType: 'builtin-limiter',
        });
        if (!node) {
            throw new Error('expected a builtin-limiter offline node');
        }
        const release = (node.namedNodes!.comp as unknown as { release: ReturnType<typeof makeParam> }).release;

        schedule(
            [
                makeLane({
                    parameterId: 'limiter-1:lim-release',
                    parameterName: 'Release',
                    minValue: 10,
                    maxValue: 500,
                    points: [{ beat: 0, value: 100, curve: 'linear', tension: 0 }],
                }),
            ],
            [
                {
                    deviceId: 'limiter-1',
                    deviceType: 'builtin-limiter',
                    strategy: new WebAudioDeviceStrategy(node, 'builtin-limiter'),
                },
            ]
        );

        expect(release.setValueAtTime).toHaveBeenCalled();
    });

    it('does not refuse a ceiling lane the project disabled, which the scheduler already excludes', () => {
        // The chain carries the limiter, so this lane would refuse if the
        // `enabled !== false` exclusion above it stopped running.
        const { gain } = schedule([{ ...CEILING_LANE, enabled: false }], [limiterEntry()]);

        expect(gain.setValueAtTime).not.toHaveBeenCalled();
    });

    it('does not refuse a ceiling lane with no points, which the scheduler already excludes', () => {
        const { gain } = schedule([{ ...CEILING_LANE, points: [] }], [limiterEntry()]);

        expect(gain.setValueAtTime).not.toHaveBeenCalled();
    });
});
