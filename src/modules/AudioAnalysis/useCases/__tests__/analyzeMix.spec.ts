import { describe, it, expect, vi, beforeEach } from 'vitest';

import { analyzeMix } from '../analyzeMix';

const mocks = vi.hoisted(() => ({
    getMasterAnalyser: vi.fn<() => AnalyserNode>(),
    getTrackStrip: vi.fn(),
    getTrackStoreState: vi.fn(() => ({ tracks: [], selectedTrackId: null })),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getMasterAnalyser: mocks.getMasterAnalyser,
    getTrackStrip: mocks.getTrackStrip,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

/**
 * AnalyserNode-compatible fixture. The -Infinity frequency data is what a real
 * WebAudio analyser reports for stopped/never-rendered output (the issue #3842
 * probe), and all-zero time data is digital silence.
 */
function fixtureAnalyser(input: {
    sampleRate?: number;
    binCount?: number;
    state?: 'running' | 'suspended' | 'closed';
    timeData?: 'zero' | 'signal';
    frequencyData?: 'silent' | 'bass-tone';
}): AnalyserNode {
    const binCount = input.binCount ?? 128;
    return {
        frequencyBinCount: binCount,
        context: { sampleRate: input.sampleRate ?? 48_000, state: input.state ?? 'running' },
        getFloatTimeDomainData: (data: Float32Array) => {
            data.fill(input.timeData === 'signal' ? 0.25 : 0);
        },
        getFloatFrequencyData: (data: Float32Array) => {
            data.fill(Number.NEGATIVE_INFINITY);
            if (input.frequencyData === 'bass-tone') {
                // 1024 bins at 48 kHz → 23.4 Hz spacing: bins 3–8 sit inside the
                // 60–250 Hz bass band.
                data.fill(-12, 3, 9);
            }
        },
    } as unknown as AnalyserNode;
}

describe('analyzeMix', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [], selectedTrackId: null });
        mocks.getTrackStrip.mockReturnValue(undefined);
    });

    it('reports measured evidence with finite readings for actual program material', async () => {
        mocks.getMasterAnalyser.mockReturnValue(
            fixtureAnalyser({ binCount: 1024, timeData: 'signal', frequencyData: 'bass-tone' })
        );

        const out = await analyzeMix();

        expect(out.status).toEqual({ availability: 'measured', provenance: 'live-analyser-snapshot' });
        expect(out.overallLevel.peakDb).toBeCloseTo(-12.0412, 3);
        expect(out.overallLevel.rmsDb).toBeCloseTo(-12.0412, 3);
        // Bass owns bins 3–10 at this spacing: six -12 dB bins averaged with
        // two silent ones.
        expect(out.frequencyBalance.bass).toBeCloseTo(-13.2494, 3);
        expect(out.trackLevels).toEqual([]);
        // Every serialized number is finite — no Infinity reaches the panel.
        expect(Object.values(out.frequencyBalance).every((value) => value === null || Number.isFinite(value))).toBe(
            true
        );
    });

    it('refuses a silent mix instead of declaring it healthy — the issue #3842 reproduction', async () => {
        // 128 bins of -Infinity plus zero time data: the exact fixture the
        // issue executed against the original helpers, which answered
        // "Mix has good frequency balance and healthy levels".
        mocks.getMasterAnalyser.mockReturnValue(fixtureAnalyser({ binCount: 128, timeData: 'zero' }));

        const out = await analyzeMix();

        expect(out.status).toEqual({
            availability: 'insufficient',
            reason: 'no-signal',
            provenance: 'live-analyser-snapshot',
        });
        expect(out.issues.some((issue) => /No signal measured/u.test(issue.message))).toBe(true);
        expect(out.suggestions).not.toContain('Mix has good frequency balance and healthy levels');
        expect(out.suggestions[0]).toMatch(/Start playback/u);
    });

    it('refuses evidence while the audio context is suspended or closed', async () => {
        mocks.getMasterAnalyser.mockReturnValue(
            fixtureAnalyser({ binCount: 1024, state: 'suspended', timeData: 'signal', frequencyData: 'bass-tone' })
        );

        const suspended = await analyzeMix();
        expect(suspended.status).toEqual({
            availability: 'insufficient',
            reason: 'audio-context-suspended',
            provenance: 'live-analyser-snapshot',
        });
        expect(suspended.suggestions).not.toContain('Mix has good frequency balance and healthy levels');

        mocks.getMasterAnalyser.mockReturnValue(
            fixtureAnalyser({ binCount: 1024, state: 'closed', timeData: 'signal', frequencyData: 'bass-tone' })
        );
        const closed = await analyzeMix();
        expect(closed.status).toMatchObject({ availability: 'insufficient', reason: 'audio-context-suspended' });
    });

    it('names the unresolvable low bands and withholds sub/bass advice at meter resolution', async () => {
        // 128 bins at 48 kHz → 187.5 Hz spacing: no bin center falls in the
        // 20–60 Hz sub band, so sub advice would be invented.
        mocks.getMasterAnalyser.mockReturnValue(
            fixtureAnalyser({ binCount: 128, timeData: 'signal', frequencyData: 'bass-tone' })
        );

        const out = await analyzeMix();

        expect(out.frequencyBalance.sub).toBeNull();
        expect(out.status.availability).toBe('measured');
        expect(out.issues.some((issue) => /187\.5 Hz bin spacing/u.test(issue.message))).toBe(true);
        expect(out.suggestions).not.toContain('Mix has good frequency balance and healthy levels');
    });

    it('returns empty trackLevels when no tracks', async () => {
        mocks.getMasterAnalyser.mockReturnValue(
            fixtureAnalyser({ binCount: 1024, timeData: 'signal', frequencyData: 'bass-tone' })
        );
        mocks.getTrackStoreState.mockReturnValue({ tracks: [], selectedTrackId: null });

        const out = await analyzeMix();

        expect(out.trackLevels).toEqual([]);
        expect(mocks.getTrackStoreState).toHaveBeenCalled();
    });
});
