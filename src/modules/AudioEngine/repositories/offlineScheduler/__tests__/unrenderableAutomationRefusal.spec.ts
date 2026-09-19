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
 * The limiter as the offline chain builds it, with the real strategy: the
 * ceiling resolves a frame-addressed `curveWrite` binding whose cap is the
 * clipper's rebuilt WaveShaper curve, not an AudioParam (#4437).
 */
function makeLimiter(contributesAudio = true) {
    const node = createOfflineDeviceNode({
        context: asBaseAudioContext(createMockAudioContext()),
        deviceType: 'builtin-limiter',
    });
    if (!node) {
        throw new Error('expected a builtin-limiter offline node');
    }
    return {
        node,
        entry: {
            deviceId: 'limiter-1',
            deviceType: 'builtin-limiter',
            contributesAudio,
            strategy: new WebAudioDeviceStrategy(node, 'builtin-limiter'),
        },
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
        // The descriptor law states the admission and the range clamp the live
        // path runs, so a case rides the same law the ceiling is admitted under.
        deviceParameterLaw: descriptorFixtureDeviceLaw(),
        durationSeconds: 10,
        defaultTempo: 120,
        changes: [],
    });
    return { gain };
}

describe('unrenderableAutomationRefusal', () => {
    it('names the parameter, the missing frame scheduler and what the musician can change', () => {
        const refusal = unrenderableAutomationRefusal({
            deviceType: 'builtin-limiter',
            parameterId: 'lim-ceiling',
            contributesAudio: true,
        });

        expect(refusal).toContain('lim-ceiling');
        expect(refusal).toMatch(/clipping curve/i);
        expect(refusal).toMatch(/no frame scheduler/i);
        expect(refusal).toMatch(/remove the lane, disable it, or set a static value/i);
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
});

describe('scheduleTrackAutomation — a frame-addressed lane with no frame scheduler (#4437)', () => {
    it('fails closed rather than dropping a contributing ceiling lane silently', () => {
        const { node, entry } = makeLimiter();
        const ceiling = node.namedNodes!.ceiling as GainNode;
        const clipper = node.namedNodes!.clipper as unknown as { curve: Float32Array | null };
        const staticCeilingGain = ceiling.gain.value;
        const staticCurve = clipper.curve;

        expect(() => schedule([CEILING_LANE], [entry])).toThrow(/lim-ceiling/);

        // The refusal is the whole observable: a caller that caught it is not
        // left with a half-applied lane, and no write was silently skipped.
        expect(ceiling.gain.value).toBe(staticCeilingGain);
        expect(clipper.curve).toBe(staticCurve);
    });

    it('drops the same lane without refusing when the strip does not contribute audio', () => {
        const { entry } = makeLimiter(false);

        const { gain } = schedule([CEILING_LANE], [entry]);

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
        const { node, entry } = makeLimiter();
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
            [entry]
        );

        expect(release.setValueAtTime).toHaveBeenCalled();
    });

    it('does not refuse a ceiling lane the project disabled, which the scheduler already excludes', () => {
        // The chain carries the limiter, so this lane would refuse if the
        // `enabled !== false` exclusion above it stopped running.
        const { gain } = schedule([{ ...CEILING_LANE, enabled: false }], [makeLimiter().entry]);

        expect(gain.setValueAtTime).not.toHaveBeenCalled();
    });

    it('does not refuse a ceiling lane with no points, which the scheduler already excludes', () => {
        const { gain } = schedule([{ ...CEILING_LANE, points: [] }], [makeLimiter().entry]);

        expect(gain.setValueAtTime).not.toHaveBeenCalled();
    });
});
