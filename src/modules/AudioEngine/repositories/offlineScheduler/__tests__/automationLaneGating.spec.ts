import { describe, it, expect, vi } from 'vitest';

import { dbToGain } from '#/utils/audioLevelLaw';

import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { scheduleTrackAutomation } from '../automationScheduling';

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

/** 120 bpm, no tempo changes → beatToSeconds(beat) === beat / 2. */
function schedule(lane: AutomationLane) {
    const gain = makeParam();
    const pan = makeParam();
    scheduleTrackAutomation(
        [lane],
        'track-1',
        { gain } as unknown as GainNode,
        { pan } as unknown as StereoPannerNode,
        [],
        10,
        120,
        []
    );
    return { gain, pan };
}

function rampValues(param: ReturnType<typeof makeParam>): number[] {
    return param.linearRampToValueAtTime.mock.calls.map((call) => call[0] as number);
}

describe('offline lane.enabled gating (AU-9)', () => {
    it('emits nothing for a lane whose enabled flag is false', () => {
        const { gain } = schedule(
            makeLane({
                id: 'lane-disabled',
                enabled: false,
                points: [
                    { beat: 0, value: 0.25, curve: 'linear', tension: 0 },
                    { beat: 4, value: 0.75, curve: 'linear', tension: 0 },
                ],
            })
        );

        expect(gain.setValueAtTime).not.toHaveBeenCalled();
        expect(gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    });

    it('emits the same curve when that lane is enabled', () => {
        const { gain } = schedule(
            makeLane({
                id: 'lane-enabled',
                enabled: true,
                points: [
                    { beat: 0, value: 0.25, curve: 'linear', tension: 0 },
                    { beat: 4, value: 0.75, curve: 'linear', tension: 0 },
                ],
            })
        );

        expect(gain.setValueAtTime).toHaveBeenCalledWith(0.25, 0);
        expect(rampValues(gain).at(-1)).toBeCloseTo(0.75, 10);
    });
});

describe('offline gain automation obeys the fader level law (AU-10)', () => {
    it('clamps gain automation above unity, as the live fader write does', () => {
        const { gain } = schedule(
            makeLane({
                id: 'lane-hot',
                maxValue: 4,
                points: [
                    { beat: 0, value: 0.5, curve: 'linear', tension: 0 },
                    { beat: 4, value: 2, curve: 'linear', tension: 0 },
                ],
            })
        );

        // Live: TrackNode.scheduleGainAutomation clamps to [0, 1] before ramping,
        // so a >unity automation point can never be heard during playback. The
        // bounce must not exceed what playback can produce.
        expect(gain.setValueAtTime).toHaveBeenCalledWith(0.5, 0);
        expect(Math.max(...rampValues(gain))).toBeLessThanOrEqual(1);
        expect(rampValues(gain).at(-1)).toBeCloseTo(1, 10);
    });

    it('applies the law after linkScale, so an inverted gain link floors at silence', () => {
        // The AU-3 link tests observe the linkScale algebra on `pan`, which has no
        // level law. This is the gain-side counterpart: the composition. An
        // inverting link resolves the source 0.6 to -0.6, and the fader floor
        // turns that into silence rather than a phase-inverted signal — which is
        // exactly what live playback does, since TrackNode clamps every fader
        // write. Pre-AU-10 the bounce scheduled a literal -0.6 gain.
        const gain = makeParam();
        const source = makeLane({
            id: 'link-source',
            trackId: 'other-track',
            points: [
                { beat: 0, value: 0.6, curve: 'linear', tension: 0 },
                { beat: 4, value: 0.6, curve: 'linear', tension: 0 },
            ],
        });
        const follower: AutomationLane = {
            ...makeLane({ id: 'link-follower', trackId: 'track-1', points: [] }),
            linkedLaneId: 'link-source',
            linkScale: -1,
        };

        scheduleTrackAutomation(
            [follower, source],
            'track-1',
            { gain } as unknown as GainNode,
            { pan: makeParam() } as unknown as StereoPannerNode,
            [],
            10,
            120,
            []
        );

        expect(gain.setValueAtTime).toHaveBeenCalledWith(0, 0);
        expect(rampValues(gain).every((value) => value >= 0)).toBe(true);
    });

    it('converts a decibel-ranged gain lane to linear amplitude, as the live path does', () => {
        // Live applyAutomation treats a lane with minValue < 0 as a dB lane and
        // writes dbToGain(value); offline read the raw dB number as a linear
        // multiplier, so -6 dB rendered as a gain of -6 (phase-inverted, 6x hot).
        const { gain } = schedule(
            makeLane({
                id: 'lane-db',
                minValue: -60,
                maxValue: 6,
                points: [{ beat: 0, value: -6, curve: 'linear', tension: 0 }],
            })
        );

        expect(gain.setValueAtTime).toHaveBeenCalledWith(dbToGain(-6), 0);
    });
});
