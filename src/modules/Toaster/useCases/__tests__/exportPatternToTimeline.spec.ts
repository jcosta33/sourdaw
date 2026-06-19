import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { getAllTracks, addClip } from '#/modules/Arrangement/useCases';
import { addMidiNote } from '#/modules/MIDI/useCases';

import { exportPatternToTimeline } from '../exportPatternToTimeline';

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getAllTracks: vi.fn(),
    addClip: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    addMidiNote: vi.fn(),
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    playheadPositionRef: { current: 0 },
}));

type StoreShape = Record<string, unknown> | null;
const { mockStore } = vi.hoisted(() => ({ mockStore: { value: null as StoreShape } }));

vi.mock('../../stores/toasterStore', () => ({
    toasterStore: {
        get value() {
            return mockStore.value;
        },
        set: vi.fn(),
    },
}));

const DEVICE_ID = 'tstr-1';

function makeStep(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        active: false,
        velocity: 0.8,
        probability: 1,
        microTiming: 0,
        retriggerCount: 0,
        condition: 'always',
        paramLocks: {},
        ...overrides,
    };
}

describe('exportPatternToTimeline', () => {
    beforeEach(() => {
        Container.clear();
        vi.mocked(getAllTracks).mockReset();
        vi.mocked(addClip).mockReset();
        vi.mocked(addMidiNote).mockReset();
        mockStore.value = null;
    });

    it('does not add clips when there are no tracks', () => {
        mockStore.value = null;
        vi.mocked(getAllTracks).mockReturnValue([]);

        exportPatternToTimeline(DEVICE_ID);

        expect(addClip).not.toHaveBeenCalled();
        expect(addMidiNote).not.toHaveBeenCalled();
    });

    it('maps each pad to the child track at its pad ordinal, not a raw filtered index', () => {
        // Two pads have steps: pad 0 and pad 2. The exporter must route them to
        // the 1st and 3rd children, never collapse onto adjacent children.
        const parent = { id: 'parent', parentId: null, devices: [{ id: DEVICE_ID }] };
        const children = Array.from({ length: 4 }, (_, i) => ({
            id: `child-${i}`,
            name: `Pad ${i}`,
            parentId: 'parent',
            devices: [],
        }));
        vi.mocked(getAllTracks).mockReturnValue([parent, ...children] as never);
        vi.mocked(addClip).mockImplementation(({ trackId }) => ({ id: `clip-for-${trackId}` }) as never);

        mockStore.value = {
            [DEVICE_ID]: {
                kit: {
                    swing: 0,
                    activePatternId: 'A1',
                    patterns: [
                        {
                            id: 'A1',
                            stepsPerBar: 16,
                            bars: 1,
                            tracks: [
                                { padIndex: 0, steps: [makeStep({ active: true })] },
                                { padIndex: 2, steps: [makeStep({ active: true })] },
                            ],
                        },
                    ],
                },
            },
        };

        exportPatternToTimeline(DEVICE_ID);

        const clipTrackIds = vi.mocked(addClip).mock.calls.map(([input]) => input.trackId);
        expect(clipTrackIds).toEqual(['child-0', 'child-2']);

        // Pad 0 → note 36 on child-0; pad 2 → note 38 on child-2.
        expect(addMidiNote).toHaveBeenCalledWith(
            'clip-for-child-0',
            36,
            expect.any(Number),
            expect.any(Number),
            expect.any(Number)
        );
        expect(addMidiNote).toHaveBeenCalledWith(
            'clip-for-child-2',
            38,
            expect.any(Number),
            expect.any(Number),
            expect.any(Number)
        );
    });

    it('derives clip length from the track step grid, not a hard-coded 4 beats/bar', () => {
        // Polymetric: pattern is 16 steps/bar over 2 bars, but this pad runs a
        // 12-step loop (stepsOverride). The old code wrote bars*4 = 8 beats; the
        // grid-derived length is 12 * (4/16) = 3 beats. This case discriminates
        // the meter bug.
        const parent = { id: 'parent', parentId: null, devices: [{ id: DEVICE_ID }] };
        const child = { id: 'child-0', name: 'Kick', parentId: 'parent', devices: [] };
        vi.mocked(getAllTracks).mockReturnValue([parent, child] as never);
        const captured: Array<{ startBeat: number; endBeat: number }> = [];
        vi.mocked(addClip).mockImplementation((input) => {
            captured.push({ startBeat: input.startBeat, endBeat: input.endBeat });
            return { id: 'clip' } as never;
        });

        mockStore.value = {
            [DEVICE_ID]: {
                kit: {
                    swing: 0,
                    activePatternId: 'A1',
                    patterns: [
                        {
                            id: 'A1',
                            stepsPerBar: 16,
                            bars: 2,
                            tracks: [
                                {
                                    padIndex: 0,
                                    stepsOverride: 12,
                                    steps: [
                                        makeStep({ active: true }),
                                        ...Array.from({ length: 31 }, () => makeStep()),
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        };

        exportPatternToTimeline(DEVICE_ID);

        expect(captured).toEqual([{ startBeat: 0, endBeat: 3 }]);
    });

    it('bakes micro-timing and swing into note start beats', () => {
        const parent = { id: 'parent', parentId: null, devices: [{ id: DEVICE_ID }] };
        const child = { id: 'child-0', name: 'Kick', parentId: 'parent', devices: [] };
        vi.mocked(getAllTracks).mockReturnValue([parent, child] as never);
        vi.mocked(addClip).mockReturnValue({ id: 'clip' } as never);

        // 4 steps/bar → stepDuration 1 beat. Step 1 (odd) gets swing push of
        // 0.5 * 1 * 0.5 = 0.25 plus micro 0.1 → start 1 + 0.1 + 0.25 = 1.35.
        mockStore.value = {
            [DEVICE_ID]: {
                kit: {
                    swing: 0.5,
                    activePatternId: 'A1',
                    patterns: [
                        {
                            id: 'A1',
                            stepsPerBar: 4,
                            bars: 1,
                            tracks: [
                                {
                                    padIndex: 0,
                                    steps: [
                                        makeStep({ active: true }), // step 0, even → no swing
                                        makeStep({ active: true, microTiming: 0.1 }), // step 1, odd
                                        makeStep(),
                                        makeStep(),
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        };

        exportPatternToTimeline(DEVICE_ID);

        const starts = vi.mocked(addMidiNote).mock.calls.map(([, , startBeat]) => startBeat);
        expect(starts[0]).toBeCloseTo(0, 10);
        expect(starts[1]).toBeCloseTo(1.35, 10);
    });

    it('emits retrigger notes with the player decay-velocity model', () => {
        const parent = { id: 'parent', parentId: null, devices: [{ id: DEVICE_ID }] };
        const child = { id: 'child-0', name: 'Kick', parentId: 'parent', devices: [] };
        vi.mocked(getAllTracks).mockReturnValue([parent, child] as never);
        vi.mocked(addClip).mockReturnValue({ id: 'clip' } as never);

        // 4 steps/bar → stepDuration 1 beat. retriggerCount 2 → base note plus
        // 2 ratchets at 1/3 and 2/3 of the step, decaying velocity.
        mockStore.value = {
            [DEVICE_ID]: {
                kit: {
                    swing: 0,
                    activePatternId: 'A1',
                    patterns: [
                        {
                            id: 'A1',
                            stepsPerBar: 4,
                            bars: 1,
                            tracks: [
                                {
                                    padIndex: 0,
                                    steps: [
                                        makeStep({ active: true, velocity: 1, retriggerCount: 2 }),
                                        makeStep(),
                                        makeStep(),
                                        makeStep(),
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        };

        exportPatternToTimeline(DEVICE_ID);

        const calls = vi.mocked(addMidiNote).mock.calls;
        expect(calls).toHaveLength(3); // base + 2 ratchets

        const [, , baseStart, , baseVel] = calls[0]!;
        expect(baseStart).toBeCloseTo(0, 10);
        expect(baseVel).toBe(127);

        const [, , r1Start, , r1Vel] = calls[1]!;
        expect(r1Start).toBeCloseTo(1 / 3, 10);
        expect(r1Vel).toBe(Math.round(127 * (1 - 0.12)));

        const [, , r2Start, , r2Vel] = calls[2]!;
        expect(r2Start).toBeCloseTo(2 / 3, 10);
        expect(r2Vel).toBe(Math.round(127 * (1 - 0.24)));
    });
});
