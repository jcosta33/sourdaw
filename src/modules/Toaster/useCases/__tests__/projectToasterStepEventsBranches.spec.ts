import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectToasterPatternGroove } from '../projectToasterPatternGroove';
import { projectToasterStepEvents } from '../projectToasterStepEvents';

vi.mock('../projectToasterPatternGroove', () => ({
    projectToasterPatternGroove: vi.fn(),
}));

function makeStep(overrides: Partial<Parameters<typeof projectToasterStepEvents>[0]['step']> = {}) {
    return {
        active: true,
        velocity: 1,
        probability: 1,
        microTiming: 0,
        retriggerCount: 0,
        condition: 'always' as const,
        paramLocks: {},
        ...overrides,
    };
}

function project(overrides: Partial<Parameters<typeof projectToasterStepEvents>[0]> = {}) {
    return projectToasterStepEvents({
        deviceId: 'toaster-a',
        patternId: 'pattern-a',
        stepsPerBar: 16,
        loopLengthBeats: 4,
        padIndex: 0,
        stepIndex: 0,
        step: makeStep(),
        swing: 0,
        ...overrides,
    });
}

describe('projectToasterStepEvents — swing', () => {
    beforeEach(() => {
        // Identity groove: return events unchanged.
        vi.mocked(projectToasterPatternGroove).mockImplementation((input) => ({
            ok: true,
            status: { status: 'unassigned' },
            events: input.events,
        }));
    });

    it('does not apply swing to even step indices', () => {
        const result = project({ stepIndex: 0, swing: 0.5 });
        if (!result.ok) {
            return;
        }
        // stepDurationBeats = 4/16 = 0.25. Even step: swing = 0. startBeat = 0.
        expect(result.hits[0]?.startBeat).toBe(0);
    });

    it('applies swing * stepDuration * 0.5 to odd step indices', () => {
        const result = project({ stepIndex: 1, swing: 0.5 });
        if (!result.ok) {
            return;
        }
        // stepDuration = 0.25, swing = 0.5, odd step: swingBeats = 0.5 * 0.25 * 0.5 = 0.0625.
        // startBeat = gridStartBeat(0.25) + 0.0625 = 0.3125.
        // But first hit wraps across loop boundary (0.3125 + 0.225 duration > 4? No, 0.3125 < 4).
        // First hit startBeat = 0.3125.
        expect(result.hits[0]?.startBeat).toBeCloseTo(0.3125, 4);
    });

    it('swing=0 produces no swing offset for odd steps', () => {
        const result = project({ stepIndex: 3, swing: 0 });
        if (!result.ok) {
            return;
        }
        // gridStartBeat = 3 * 0.25 = 0.75, no swing offset.
        expect(result.hits[0]?.startBeat).toBeCloseTo(0.75, 4);
    });
});

describe('projectToasterStepEvents — velocity quantization', () => {
    beforeEach(() => {
        vi.mocked(projectToasterPatternGroove).mockImplementation((input) => ({
            ok: true,
            status: { status: 'unassigned' },
            events: input.events,
        }));
    });

    it('quantizes velocity 0..1 to 0..127 via Math.round', () => {
        const result = project({ step: makeStep({ velocity: 0.5 }) });
        if (!result.ok) {
            return;
        }
        // round(0.5 * 127) = 64
        expect(result.hits[0]?.velocity).toBe(64);
    });

    it('velocity 1.0 quantizes to 127', () => {
        const result = project({ step: makeStep({ velocity: 1 }) });
        if (!result.ok) {
            return;
        }
        expect(result.hits[0]?.velocity).toBe(127);
    });

    it('velocity 0.0 quantizes to 0', () => {
        const result = project({ step: makeStep({ velocity: 0 }) });
        if (!result.ok) {
            return;
        }
        expect(result.hits[0]?.velocity).toBe(0);
    });
});

describe('projectToasterStepEvents — micro-timing offset', () => {
    beforeEach(() => {
        vi.mocked(projectToasterPatternGroove).mockImplementation((input) => ({
            ok: true,
            status: { status: 'unassigned' },
            events: input.events,
        }));
    });

    it('applies step.microTiming * stepDuration as a beat offset', () => {
        // microTiming = 0.5, stepDuration = 0.25 → offset = 0.125
        const result = project({ step: makeStep({ microTiming: 0.5 }) });
        if (!result.ok) {
            return;
        }
        // startBeat = 0 + 0.125 + 0(swing) = 0.125
        expect(result.hits[0]?.startBeat).toBeCloseTo(0.125, 4);
    });

    it('negative microTiming shifts the start backward', () => {
        // microTiming = -0.5 → offset = -0.125. startBeat = -0.125.
        // This wraps to the previous loop iteration.
        const result = project({ step: makeStep({ microTiming: -0.5 }) });
        if (!result.ok) {
            return;
        }
        // The hit wraps: startBeat = -0.125 → wrappedStartBeat = ((-0.125 % 4) + 4) % 4 = 3.875.
        // sourceLoopIndex = floor(-0.125/4) = -1. firstLoopOffsetBeats = max(0,-1)*4 = 0.
        // But nextLoopOffsetBeats = 0 (sourceLoopIndex < 0).
        const sortedHits = result.hits;
        // At least one hit must exist.
        expect(sortedHits.length).toBeGreaterThan(0);
        // The wrapped startBeat should be 3.875 (within the loop).
        const wrappedHit = sortedHits.find((h) => h.startBeat === 3.875 || Math.abs(h.startBeat - 3.875) < 0.001);
        expect(wrappedHit).toBeDefined();
    });
});

describe('projectToasterStepEvents — retrigger', () => {
    beforeEach(() => {
        vi.mocked(projectToasterPatternGroove).mockImplementation((input) => ({
            ok: true,
            status: { status: 'unassigned' },
            events: input.events,
        }));
    });

    it('produces additional hits for retriggerCount > 0', () => {
        const result = project({ step: makeStep({ retriggerCount: 2 }) });
        if (!result.ok) {
            return;
        }
        // 1 base hit + 2 retrigger hits = 3 total (before wrapping).
        // stepDuration = 0.25, subInterval = 0.25 / 3 ≈ 0.0833.
        expect(result.hits.length).toBeGreaterThanOrEqual(3);
    });

    it('retrigger velocity decays by 12% per index with a floor of 20', () => {
        const result = project({ step: makeStep({ velocity: 1, retriggerCount: 2 }) });
        if (!result.ok) {
            return;
        }
        // Base velocity = 127.
        // Retrigger 1: max(20, round(127 * (1 - 1*0.12))) = max(20, round(111.76)) = 112.
        // Retrigger 2: max(20, round(127 * (1 - 2*0.12))) = max(20, round(96.52)) = 97.
        const velocities = result.hits.map((h) => h.velocity).sort((a, b) => b - a);
        expect(velocities).toContain(127);
        expect(velocities).toContain(112);
        expect(velocities).toContain(97);
    });

    it('retrigger velocity floors at 20 for high retrigger counts', () => {
        const result = project({ step: makeStep({ velocity: 0.1, retriggerCount: 5 }) });
        if (!result.ok) {
            return;
        }
        // Base velocity = round(0.1*127) = 13 (not floored — floor only applies to retriggers).
        // Retrigger velocity = max(20, round(13 * (1 - r*0.12))). For r>=1, 13*0.88=11.4 → max(20,11)=20.
        const retriggerVelocities = result.hits.filter((h) => h.retriggerIndex > 0).map((h) => h.velocity);
        // Every retrigger velocity must be >= 20 (the floor).
        for (const v of retriggerVelocities) {
            expect(v).toBeGreaterThanOrEqual(20);
        }
        // Base hit keeps its unfloored velocity.
        const baseHit = result.hits.find((h) => h.retriggerIndex === 0);
        expect(baseHit?.velocity).toBe(13);
    });
});

describe('projectToasterStepEvents — hit duration', () => {
    beforeEach(() => {
        vi.mocked(projectToasterPatternGroove).mockImplementation((input) => ({
            ok: true,
            status: { status: 'unassigned' },
            events: input.events,
        }));
    });

    it('base hit duration is 90% of stepDurationBeats', () => {
        const result = project({ stepsPerBar: 16 });
        if (!result.ok) {
            return;
        }
        // stepDuration = 4/16 = 0.25. Duration = 0.25 * 0.9 = 0.225.
        expect(result.hits[0]?.durationBeats).toBeCloseTo(0.225, 4);
    });

    it('retrigger hit duration is 90% of the sub-interval', () => {
        const result = project({ stepsPerBar: 16, step: makeStep({ retriggerCount: 1 }) });
        if (!result.ok) {
            return;
        }
        // subInterval = 0.25 / 2 = 0.125. Duration = 0.125 * 0.9 = 0.1125.
        const retriggerHit = result.hits.find((h) => h.retriggerIndex === 1);
        expect(retriggerHit?.durationBeats).toBeCloseTo(0.1125, 4);
    });
});

describe('projectToasterStepEvents — groove projection failure', () => {
    it('propagates the failure result when groove projection fails', () => {
        vi.mocked(projectToasterPatternGroove).mockReturnValue({
            ok: false,
            status: { status: 'missing-template', templateId: 'missing' },
        });

        const result = project();
        expect(result.ok).toBe(false);
    });
});
