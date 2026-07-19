import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { getAllTracks, addClip } from '#/modules/Arrangement/useCases';
import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import { addMidiNote, assignGrooveTemplate, createGrooveTemplate } from '#/modules/MIDI/useCases';

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
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
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

    it('clamps final-step base and retrigger spill inside the exported MIDI clip', () => {
        const parent = { id: 'parent', parentId: null, devices: [{ id: DEVICE_ID }] };
        const child = { id: 'child-0', name: 'Kick', parentId: 'parent', devices: [] };
        vi.mocked(getAllTracks).mockReturnValue([parent, child] as never);
        vi.mocked(addClip).mockReturnValue({ id: 'clip' } as never);
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
                                        makeStep(),
                                        makeStep(),
                                        makeStep(),
                                        makeStep({ active: true, microTiming: 0.5, retriggerCount: 2 }),
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        };

        exportPatternToTimeline(DEVICE_ID);

        const notes = vi.mocked(addMidiNote).mock.calls;
        expect(notes).toHaveLength(3);
        for (const [, , startBeat, duration] of notes) {
            expect(startBeat).toBeLessThan(4);
            expect(startBeat + duration).toBeLessThanOrEqual(4);
        }
        expect(notes.map(([, , startBeat]) => startBeat)).toEqual([3.5, 3.5 + 1 / 3, 4 - 1 / 960]);
    });

    it('exports the same 32-step groove grid and retrigger positions as live playback', () => {
        const parent = { id: 'parent', parentId: null, devices: [{ id: DEVICE_ID }] };
        const child = { id: 'child-0', name: 'Kick', parentId: 'parent', devices: [] };
        vi.mocked(getAllTracks).mockReturnValue([parent, child] as never);
        vi.mocked(addClip).mockReturnValue({ id: 'clip' } as never);
        mockStore.value = {
            [DEVICE_ID]: {
                kit: {
                    swing: 0,
                    activePatternId: 'A1',
                    patterns: [
                        {
                            id: 'A1',
                            stepsPerBar: 32,
                            bars: 1,
                            tracks: [
                                {
                                    padIndex: 0,
                                    steps: [
                                        makeStep(),
                                        makeStep({ active: true, velocity: 1, retriggerCount: 1 }),
                                        ...Array.from({ length: 30 }, () => makeStep()),
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        };
        createGrooveTemplate({
            id: 'export-thirty-second-pocket',
            name: 'Export thirty-second pocket',
            subdivision: '1/32',
            slots: [{ index: 1, timingOffset: 0.2, dynamicsOffset: -0.1 }],
            provenance: { type: 'user', sourceId: 'test-32' },
        });
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: `groove-consumer:${DEVICE_ID}:A1`,
            templateId: 'export-thirty-second-pocket',
            amount: 1,
        });

        exportPatternToTimeline(DEVICE_ID);

        expect(addClip).toHaveBeenCalledWith(expect.objectContaining({ startBeat: 0, endBeat: 4 }));
        const calls = vi.mocked(addMidiNote).mock.calls;
        expect(calls).toHaveLength(2);
        expect(calls[0]?.slice(2)).toEqual([0.15, 0.1125, 114]);
        expect(calls[1]?.slice(2)).toEqual([0.2125, 0.05625, 100]);
    });

    it('exports the negative-offset oracle at the same early beat used by live pre-scheduling', () => {
        const parent = { id: 'parent', parentId: null, devices: [{ id: DEVICE_ID }] };
        const child = { id: 'child-0', name: 'Kick', parentId: 'parent', devices: [] };
        vi.mocked(getAllTracks).mockReturnValue([parent, child] as never);
        vi.mocked(addClip).mockReturnValue({ id: 'clip' } as never);
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
                                {
                                    padIndex: 0,
                                    steps: [
                                        makeStep(),
                                        makeStep({ active: true, velocity: 1 }),
                                        ...Array.from({ length: 14 }, () => makeStep()),
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        };
        createGrooveTemplate({
            id: 'export-early-pocket',
            name: 'Export early pocket',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: -0.5, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'early-live-export-oracle' },
        });
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: `groove-consumer:${DEVICE_ID}:A1`,
            templateId: 'export-early-pocket',
            amount: 1,
        });

        exportPatternToTimeline(DEVICE_ID);

        expect(addMidiNote).toHaveBeenCalledWith('clip', 36, 0.125, 0.225, 127);
    });

    it('rejects an unsupported assigned template before committing any timeline data', () => {
        const parent = { id: 'parent', parentId: null, devices: [{ id: DEVICE_ID }] };
        const child = { id: 'child-0', name: 'Kick', parentId: 'parent', devices: [] };
        vi.mocked(getAllTracks).mockReturnValue([parent, child] as never);
        vi.mocked(addClip).mockReturnValue({ id: 'clip' } as never);
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
                            tracks: [{ padIndex: 0, steps: [makeStep({ active: true })] }],
                        },
                    ],
                },
            },
        };
        createGrooveTemplate({
            id: 'unsupported-eighth-groove',
            name: 'Unsupported eighth groove',
            subdivision: '1/8',
            slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'unsupported-export' },
        });
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: `groove-consumer:${DEVICE_ID}:A1`,
            templateId: 'unsupported-eighth-groove',
            amount: 1,
        });

        const result = exportPatternToTimeline(DEVICE_ID);

        expect(result).toEqual({
            ok: false,
            status: {
                status: 'unsupported',
                templateId: 'unsupported-eighth-groove',
                templateName: 'Unsupported eighth groove',
                amount: 1,
                error: { code: 'unsupported-subdivision', consumer: 'toaster', subdivision: '1/8' },
            },
        });
        expect(addClip).not.toHaveBeenCalled();
        expect(addMidiNote).not.toHaveBeenCalled();
    });
});
