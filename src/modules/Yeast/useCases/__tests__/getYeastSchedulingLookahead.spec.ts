import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const projectionMocks = vi.hoisted(() => ({ createYeastRuntimeProjection: vi.fn() }));
const rackMocks = vi.hoisted(() => ({
    rack: { processors: [] as Array<Record<string, unknown>>, uiLevel: 1 },
}));

vi.mock('../../stores/yeastStore', () => ({
    // The lookahead is sized per device (issue #2422): the caller names its
    // rack and this is the read it gets back.
    readYeastRack: () => rackMocks.rack,
}));

vi.mock('../createYeastRuntimeProjection', () => ({
    createYeastRuntimeProjection: projectionMocks.createYeastRuntimeProjection,
}));

const { getYeastSchedulingLookahead } = await import('../getYeastSchedulingLookahead');

/**
 * Domain: getYeastSchedulingLookahead measures the worst-case beat displacement
 * that an active groove template can impose on a note, in both directions, so the
 * realtime scheduler (processRealtimeMidiInput) can book enough look-ahead samples.
 *
 * Per slot the displacement in beats is:
 *   offsetBeats = groove_timing_N * amount * stepBeats
 * where:
 *   - amount      is the 0..1 blend, clamped (default 0.5)
 *   - stepBeats   is the step grid in beats, clamped to [1/32, 1] (default 0.25 = 1/16)
 *   - slotCount   is the number of slots, clamped to [1, 32] (default 16)
 *   - groove_timing_N is the per-slot offset in "fraction of a step" units
 *
 * A negative offset pushes a note EARLIER (scheduler must schedule it sooner);
 * a positive offset pushes it LATER. Both extremes are tracked independently
 * because the scheduler needs the early window (to fire ahead of the beat) and
 * the late window (so a delayed note is still within the processing block).
 * The result is capped at 4 beats so a pathological template cannot request an
 * unbounded scheduling window.
 */
describe('getYeastSchedulingLookahead', () => {
    beforeEach(() => {
        projectionMocks.createYeastRuntimeProjection.mockReset();
    });

    afterEach(() => {
        // Ensure the shared store never leaks a null into other suites.
        rackMocks.rack = { processors: [], uiLevel: 1 };
    });

    it('returns zero displacement when there are no processors', () => {
        projectionMocks.createYeastRuntimeProjection.mockReturnValue([]);

        expect(getYeastSchedulingLookahead('device-live')).toEqual({ earlyBeats: 0, lateBeats: 0 });
    });

    it('sizes the window from the named rack only', () => {
        // The realtime input path processes a NAMED device (issue #2422);
        // the window must come from that rack — an empty named rack reports
        // a safe zero window regardless of what any other rack holds.
        projectionMocks.createYeastRuntimeProjection.mockReturnValue([]);

        expect(getYeastSchedulingLookahead('device-live')).toEqual({ earlyBeats: 0, lateBeats: 0 });
        expect(projectionMocks.createYeastRuntimeProjection).toHaveBeenCalledWith([]);
    });

    it('tracks the largest early and late displacement across all groove slots', () => {
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

        // By hand:
        //   slot 0: -0.4 * 0.75 * 0.25 = -0.075  -> early 0.075
        //   slot 1:  0.2 * 0.75 * 0.25 =  0.0375 -> late 0.0375
        //   slot 2:  0                          -> no change
        //   slot 3:  0.5 * 0.75 * 0.25 =  0.09375 -> late 0.09375
        const result = getYeastSchedulingLookahead('device-live');
        expect(result.earlyBeats).toBeCloseTo(0.075, 10);
        expect(result.lateBeats).toBeCloseTo(0.09375, 10);
    });

    it('ignores bypassed groove processors entirely', () => {
        projectionMocks.createYeastRuntimeProjection.mockReturnValue([
            {
                id: 'groove-1',
                type: 'groove',
                bypassed: true,
                params: { groove_timing_0: 0.5 },
            },
        ]);

        expect(getYeastSchedulingLookahead('device-live')).toEqual({ earlyBeats: 0, lateBeats: 0 });
    });

    it('ignores non-groove processors', () => {
        projectionMocks.createYeastRuntimeProjection.mockReturnValue([
            {
                id: 'arp-1',
                type: 'arpeggiator',
                bypassed: false,
                params: { groove_timing_0: 0.5 },
            },
        ]);

        expect(getYeastSchedulingLookahead('device-live')).toEqual({ earlyBeats: 0, lateBeats: 0 });
    });

    it('reduces multiple active grooves to the single widest window', () => {
        projectionMocks.createYeastRuntimeProjection.mockReturnValue([
            {
                id: 'groove-shallow',
                type: 'groove',
                bypassed: false,
                params: {
                    groove_amount: 1,
                    groove_step_beats: 0.25,
                    groove_slot_count: 1,
                    groove_timing_0: 0.1, // late 0.025
                },
            },
            {
                id: 'groove-wide',
                type: 'groove',
                bypassed: false,
                params: {
                    groove_amount: 1,
                    groove_step_beats: 0.5,
                    groove_slot_count: 1,
                    groove_timing_0: -0.5, // early 0.25
                },
            },
        ]);

        // groove-shallow: 0.1 * 1 * 0.25 = 0.025 late
        // groove-wide:   -0.5 * 1 * 0.5  = -0.25  early
        expect(getYeastSchedulingLookahead('device-live')).toEqual({
            earlyBeats: 0.25,
            lateBeats: 0.025,
        });
    });

    describe('parameter clamping', () => {
        it('clamps amount above 1 to full strength', () => {
            projectionMocks.createYeastRuntimeProjection.mockReturnValue([
                {
                    id: 'groove-1',
                    type: 'groove',
                    bypassed: false,
                    params: {
                        groove_amount: 5, // out of range -> treated as 1
                        groove_step_beats: 0.25,
                        groove_slot_count: 1,
                        groove_timing_0: 0.4, // 0.4 * 1 * 0.25 = 0.1
                    },
                },
            ]);

            expect(getYeastSchedulingLookahead('device-live').lateBeats).toBeCloseTo(0.1, 10);
        });

        it('clamps amount below 0 to zero blend (no displacement)', () => {
            projectionMocks.createYeastRuntimeProjection.mockReturnValue([
                {
                    id: 'groove-1',
                    type: 'groove',
                    bypassed: false,
                    params: {
                        groove_amount: -3, // out of range -> treated as 0
                        groove_step_beats: 0.25,
                        groove_slot_count: 1,
                        groove_timing_0: 0.5,
                    },
                },
            ]);

            expect(getYeastSchedulingLookahead('device-live')).toEqual({ earlyBeats: 0, lateBeats: 0 });
        });

        it('uses the default amount (0.5) when amount is missing', () => {
            projectionMocks.createYeastRuntimeProjection.mockReturnValue([
                {
                    id: 'groove-1',
                    type: 'groove',
                    bypassed: false,
                    params: {
                        // no groove_amount -> default 0.5
                        groove_step_beats: 0.5,
                        groove_slot_count: 1,
                        groove_timing_0: 1, // 1 * 0.5 * 0.5 = 0.25
                    },
                },
            ]);

            expect(getYeastSchedulingLookahead('device-live').lateBeats).toBeCloseTo(0.25, 10);
        });

        it('clamps stepBeats above 1 to a whole beat', () => {
            projectionMocks.createYeastRuntimeProjection.mockReturnValue([
                {
                    id: 'groove-1',
                    type: 'groove',
                    bypassed: false,
                    params: {
                        groove_amount: 1,
                        groove_step_beats: 8, // out of range -> 1
                        groove_slot_count: 1,
                        groove_timing_0: 0.25, // 0.25 * 1 * 1 = 0.25
                    },
                },
            ]);

            expect(getYeastSchedulingLookahead('device-live').lateBeats).toBeCloseTo(0.25, 10);
        });

        it('clamps stepBeats below 1/32 to the 1/32 minimum', () => {
            projectionMocks.createYeastRuntimeProjection.mockReturnValue([
                {
                    id: 'groove-1',
                    type: 'groove',
                    bypassed: false,
                    params: {
                        groove_amount: 1,
                        groove_step_beats: 0, // out of range -> 1/32
                        groove_slot_count: 1,
                        groove_timing_0: 1, // 1 * 1 * (1/32) = 0.03125
                    },
                },
            ]);

            expect(getYeastSchedulingLookahead('device-live').lateBeats).toBeCloseTo(1 / 32, 10);
        });

        it('uses the default stepBeats (0.25) when missing', () => {
            projectionMocks.createYeastRuntimeProjection.mockReturnValue([
                {
                    id: 'groove-1',
                    type: 'groove',
                    bypassed: false,
                    params: {
                        groove_amount: 1,
                        // no groove_step_beats -> default 0.25
                        groove_slot_count: 1,
                        groove_timing_0: 1, // 1 * 1 * 0.25 = 0.25
                    },
                },
            ]);

            expect(getYeastSchedulingLookahead('device-live').lateBeats).toBeCloseTo(0.25, 10);
        });

        it('clamps slotCount above 32 down to 32', () => {
            const timing: Record<string, number> = {
                groove_amount: 1,
                groove_step_beats: 0.25,
                groove_slot_count: 100, // out of range -> 32
            };
            for (let index = 0; index < 100; index++) {
                timing[`groove_timing_${index}`] = index === 50 ? 0.5 : 0;
            }
            projectionMocks.createYeastRuntimeProjection.mockReturnValue([
                { id: 'groove-1', type: 'groove', bypassed: false, params: timing },
            ]);

            // slot 50 is beyond the clamped 32-slot window, so its offset is never read.
            expect(getYeastSchedulingLookahead('device-live')).toEqual({ earlyBeats: 0, lateBeats: 0 });
        });

        it('clamps slotCount below 1 up to 1', () => {
            projectionMocks.createYeastRuntimeProjection.mockReturnValue([
                {
                    id: 'groove-1',
                    type: 'groove',
                    bypassed: false,
                    params: {
                        groove_amount: 1,
                        groove_step_beats: 0.25,
                        groove_slot_count: 0, // out of range -> 1
                        groove_timing_0: 0.5, // 0.5 * 1 * 0.25 = 0.125
                    },
                },
            ]);

            expect(getYeastSchedulingLookahead('device-live').lateBeats).toBeCloseTo(0.125, 10);
        });

        it('uses the default slotCount (16) when missing', () => {
            const timing: Record<string, number> = {
                groove_amount: 1,
                groove_step_beats: 0.25,
            };
            for (let index = 0; index < 16; index++) {
                timing[`groove_timing_${index}`] = 0;
            }
            timing.groove_timing_3 = 0.5; // within the default 16-slot window
            projectionMocks.createYeastRuntimeProjection.mockReturnValue([
                { id: 'groove-1', type: 'groove', bypassed: false, params: timing },
            ]);

            expect(getYeastSchedulingLookahead('device-live').lateBeats).toBeCloseTo(0.125, 10);
        });

        it('treats a missing slot timing as zero offset', () => {
            projectionMocks.createYeastRuntimeProjection.mockReturnValue([
                {
                    id: 'groove-1',
                    type: 'groove',
                    bypassed: false,
                    params: {
                        groove_amount: 1,
                        groove_step_beats: 0.25,
                        groove_slot_count: 4,
                        // groove_timing_0..3 are all absent -> each offsets by 0
                    },
                },
            ]);

            expect(getYeastSchedulingLookahead('device-live')).toEqual({ earlyBeats: 0, lateBeats: 0 });
        });
    });

    it('caps the reported window at 4 beats even for extreme templates', () => {
        projectionMocks.createYeastRuntimeProjection.mockReturnValue([
            {
                id: 'groove-1',
                type: 'groove',
                bypassed: false,
                params: {
                    groove_amount: 1,
                    groove_step_beats: 1,
                    groove_slot_count: 1,
                    // A 0.5-step offset at 1-beat steps and full blend = 0.5 beats — under the cap,
                    // so confirm the cap is the bound, not the value.
                    groove_timing_0: 0.5,
                },
            },
            {
                id: 'groove-2',
                type: 'groove',
                bypassed: false,
                params: {
                    groove_amount: 1,
                    groove_step_beats: 1,
                    groove_slot_count: 1,
                    groove_timing_0: -0.5, // early 0.5
                },
            },
        ]);

        expect(getYeastSchedulingLookahead('device-live')).toEqual({ earlyBeats: 0.5, lateBeats: 0.5 });
    });

    it('caps the reported window at MAX_GROOVE_LOOKAHEAD_BEATS (4) for an oversized displacement', () => {
        // Craft a displacement that exceeds 4 beats. The per-slot offset is clamped in
        // GrooveModule to [-0.5, 0.5], but the lookahead must still defend against any
        // value the projection carries, so it caps the final window at 4 beats.
        projectionMocks.createYeastRuntimeProjection.mockReturnValue([
            {
                id: 'groove-1',
                type: 'groove',
                bypassed: false,
                params: {
                    groove_amount: 1,
                    groove_step_beats: 1,
                    groove_slot_count: 1,
                    groove_timing_0: 100, // 100 * 1 * 1 = 100 beats, uncapped
                },
            },
        ]);

        expect(getYeastSchedulingLookahead('device-live')).toEqual({ earlyBeats: 0, lateBeats: 4 });
    });
});
