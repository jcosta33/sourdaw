import { beforeEach, describe, expect, it, vi } from 'vitest';

const projectionMocks = vi.hoisted(() => ({ createYeastRuntimeProjection: vi.fn() }));

vi.mock('../createYeastRuntimeProjection', () => ({
    createYeastRuntimeProjection: projectionMocks.createYeastRuntimeProjection,
}));

const { getYeastSchedulingLookahead } = await import('../getYeastSchedulingLookahead');

describe('getYeastSchedulingLookahead', () => {
    beforeEach(() => {
        projectionMocks.createYeastRuntimeProjection.mockReset();
    });

    it('returns the largest early and late displacement in the active groove projection', () => {
        projectionMocks.createYeastRuntimeProjection.mockReturnValue([
            {
                id: 'groove-1',
                type: 'groove',
                bypassed: false,
                params: {
                    groove_amount: 0.75,
                    groove_step_beats: 0.25,
                    groove_slot_count: 4,
                    groove_timing_0: -0.4,
                    groove_timing_1: 0.2,
                    groove_timing_2: 0,
                    groove_timing_3: 0.5,
                },
            },
        ]);

        expect(getYeastSchedulingLookahead()).toEqual({
            earlyBeats: 0.07500000000000001,
            lateBeats: 0.09375,
        });
    });

    it('ignores bypassed groove processors', () => {
        projectionMocks.createYeastRuntimeProjection.mockReturnValue([
            {
                id: 'groove-1',
                type: 'groove',
                bypassed: true,
                params: { groove_timing_0: 0.5 },
            },
        ]);

        expect(getYeastSchedulingLookahead()).toEqual({ earlyBeats: 0, lateBeats: 0 });
    });
});
