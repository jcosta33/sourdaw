import { describe, it, expect, vi } from 'vitest';

import { dbToGain, FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type AutomationLane } from '../../../models/AutomationViewTypes';

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
    scheduleTrackAutomationFixture({
        lanes: [lane],
        trackId: 'track-1',
        trackGainNode: { gain } as unknown as GainNode,
        trackPanNode: { pan } as unknown as StereoPannerNode,
        deviceEntries: [],
        durationSeconds: 10,
        defaultTempo: 120,
        changes: [],
    });
    return { gain, pan };
}

function rampValues(param: ReturnType<typeof makeParam>): number[] {
    return param.linearRampToValueAtTime.mock.calls.map((call) => call[0] as number);
}

describe('offline lane.enabled gating', () => {
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

describe('offline gain automation obeys the fader level law', () => {
    it('clamps gain automation above the fader ceiling, as the live fader write does', () => {
        const { gain } = schedule(
            makeLane({
                id: 'lane-hot',
                maxValue: 4,
                points: [
                    { beat: 0, value: 0.5, curve: 'linear', tension: 0 },
                    { beat: 4, value: 3, curve: 'linear', tension: 0 },
                ],
            })
        );

        // Live: `TrackNode.scheduleGainAutomation` clamps to the fader's range
        // before ramping, so an automation point above it can never be heard
        // during playback. The bounce must not exceed what playback can produce.
        // That range tops out at `FADER_MAX_GAIN` — the `+6 dB` of headroom the
        // fader has — not at unity, and the lane here declares `maxValue: 4`, so
        // its own range is not what stops the ramp.
        expect(gain.setValueAtTime).toHaveBeenCalledWith(0.5, 0);
        expect(Math.max(...rampValues(gain))).toBeLessThanOrEqual(FADER_MAX_GAIN);
        expect(rampValues(gain).at(-1)).toBeCloseTo(FADER_MAX_GAIN, 10);
    });

    /**
     * The lane's own declared range stops the ramp first, before the fader ever
     * gets a say — the offline half of live's `clampToLaneRange`.
     */
    it('bounds gain automation at the lane range even when the fader would allow more', () => {
        const { gain } = schedule(
            makeLane({
                id: 'lane-bounded',
                // Not the legacy `1`, so `resolveLaneCeiling` reads it straight
                // and the bound under test is unambiguously the lane's own.
                maxValue: 1.2,
                points: [
                    { beat: 0, value: 0.5, curve: 'linear', tension: 0 },
                    { beat: 4, value: 3, curve: 'linear', tension: 0 },
                ],
            })
        );

        expect(Math.max(...rampValues(gain))).toBeCloseTo(1.2, 10);
        expect(1.2).toBeLessThan(FADER_MAX_GAIN);
    });

    it('applies the law after linkScale, so an inverted gain link floors at silence', () => {
        // The linked-lane tests observe the linkScale algebra on `pan`, which has no
        // level law. This is the gain-side counterpart: the composition. An
        // inverting link resolves the source 0.6 to -0.6, and the fader floor
        // turns that into silence rather than a phase-inverted signal — which is
        // exactly what live playback does, since TrackNode clamps every fader
        // write. Before the law was applied offline, the bounce scheduled a
        // literal -0.6 gain.
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

        scheduleTrackAutomationFixture({
            lanes: [follower, source],
            trackId: 'track-1',
            trackGainNode: { gain } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [],
            durationSeconds: 10,
            defaultTempo: 120,
            changes: [],
        });

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
