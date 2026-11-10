import { describe, expect, it } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { projectLoopAudioWindows } from '../projectLoopAudioWindows';

function project(overrides: Partial<Parameters<typeof projectLoopAudioWindows>[0]> = {}) {
    return projectLoopAudioWindows({
        transport: { ...defaultTransportState, tempo: 120, isLooping: true, loopStart: 0, loopEnd: 0.25 },
        changes: [],
        anchorBeat: 0,
        anchorTime: 10,
        fromTime: 10,
        toTime: 10.35,
        maxWindows: 64,
        ...overrides,
    });
}

describe('bounded loop audio windows', () => {
    it('continues one audio-clock horizon through several short-loop passes', () => {
        const result = project();
        expect(result.shortfall).toBeNull();
        expect(result.coveredThrough).toBe(10.35);
        expect(result.windows.map((window) => [window.passIndex, window.anchorTime, window.toTime])).toEqual([
            [0, 10, 10.125],
            [1, 10.125, 10.25],
            [2, 10.25, 10.35],
        ]);
        expect(result.windows.map((window) => window.toBeat)).toEqual([0.25, 0.25, expect.closeTo(0.2, 12)]);
    });
    it('skips millions of missed passes by index rather than enumerating them', () => {
        const result = project({ fromTime: 1_000_010, toTime: 1_000_010.1 });
        expect(result.windows).toHaveLength(1);
        expect(result.windows[0]?.passIndex).toBe(8_000_000);
        expect(result.windows[0]?.anchorTime).toBe(1_000_010);
    });
    it('returns exact partial coverage after the finite window allowance on a tiny legal loop', () => {
        const transport = { ...defaultTransportState, tempo: 120, isLooping: true, loopStart: 0, loopEnd: 2e-10 };
        const result = project({ transport });
        expect(result.shortfall).toBe('pass-budget');
        expect(result.windows).toHaveLength(64);
        expect(result.coveredThrough).toBeLessThan(10.000001);
        expect(result.coveredThrough).toBe(result.windows[63]?.toTime);
    });
    it('owns a representable tiny-loop boundary when the closed-form quotient rounds below its integer', () => {
        const transport = { ...defaultTransportState, tempo: 120, isLooping: true, loopStart: 0, loopEnd: 2e-10 };
        const result = project({ transport, fromTime: 10.01, toTime: 10.36 });
        expect(result.windows).toHaveLength(64);
        expect(result.windows[0]?.passIndex).toBe(100_000_000);
        expect(result.windows[0]?.anchorTime).toBe(10.01);
        expect(result.shortfall).toBe('pass-budget');
    });
    it('integrates the loop map and never charges the tempo beyond its end', () => {
        const result = project({
            transport: { ...defaultTransportState, tempo: 120, isLooping: true, loopStart: 4, loopEnd: 6 },
            changes: [
                { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'b', beat: 5, tempo: 60, curve: 'instant' },
                { id: 'c', beat: 6, tempo: 300, curve: 'instant' },
            ],
            anchorBeat: 4,
            fromTime: 11.4,
            toTime: 11.7,
        });
        // Beat4..5 costs .5s; beat5..6 costs1s. Incoming beat4..4.4 costs.2s.
        expect(result.windows.map((window) => [window.passIndex, window.anchorTime, window.toTime])).toEqual([
            [0, 10, 11.5],
            [1, 11.5, 11.7],
        ]);
        expect(result.windows[1]?.toBeat).toBeCloseTo(4.4, 12);
    });
    it('refuses nonadvancing or unsafe-index arithmetic without entering a pass walk', () => {
        expect(project({ anchorTime: 1e20, fromTime: 1e20, toTime: 1e20 }).shortfall).toBe('unrepresentable');
        expect(project({ fromTime: Number.MAX_VALUE, toTime: Number.MAX_VALUE }).windows).toEqual([]);
    });
});
