import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Track, sanitizeTrackSnapshot } from '#/modules/Arrangement/stores';
import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import { assignGrooveTemplate, createGrooveTemplate } from '#/modules/MIDI/useCases';

const mocks = vi.hoisted(() => ({
    tracks: [] as Track[],
    batch: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getAllTracks: () => mocks.tracks,
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeAppActionBatch: mocks.batch,
}));
vi.mock('#/modules/Project/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/stores')>()),
    getSettledProjectIdentity: () => ({ projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa' }),
}));
vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    playheadPositionRef: { current: 0 },
}));

import { createDefaultKit, type ToasterKit } from '../../models/ToasterKit';
import { defaultToasterState, toasterStore } from '../../stores/toasterStore';
import { exportPatternToTimeline } from '../exportPatternToTimeline';

const DEVICE_ID = 'toaster-bake';

function tracksWithChildren(count: number): Track[] {
    return sanitizeTrackSnapshot({
        selectedTrackId: null,
        tracks: [
            {
                id: 'parent',
                name: 'Drums',
                kind: 'midi',
                devices: [
                    {
                        id: DEVICE_ID,
                        name: 'Toaster',
                        type: 'toaster',
                        bypassed: false,
                        parameterValues: {},
                    },
                ],
            },
            ...Array.from({ length: count }, (_, index) => ({
                id: `child-${index}`,
                name: `Pad ${index}`,
                kind: 'midi',
                parentId: 'parent',
            })),
        ],
    }).tracks;
}

function seedKit(): ToasterKit {
    const kit = createDefaultKit();
    const a = kit.patterns[0]!;
    a.tracks[0]!.steps[0]!.active = true;
    a.tracks[0]!.steps[0]!.velocity = 1;
    const b = structuredClone(a);
    b.id = 'B1';
    b.name = 'Pattern B1';
    b.tracks[0]!.steps[0]!.active = false;
    b.tracks[0]!.steps[1]!.active = true;
    kit.patterns.push(b);
    kit.morph = { enabled: true, targetPatternId: 'B1', position: 0 };
    toasterStore.set({ [DEVICE_ID]: { ...defaultToasterState, kit } });
    return kit;
}

function bakedActions() {
    const call = mocks.batch.mock.calls[0];
    if (!call) {
        throw new Error('The batch was not called');
    }
    return call[0] as Parameters<(typeof import('#/modules/Command/useCases'))['executeAppActionBatch']>[0];
}

describe('exportPatternToTimeline', () => {
    beforeEach(() => {
        mocks.batch.mockReset();
        mocks.batch.mockResolvedValue({ status: 'committed', actions: [] });
        mocks.tracks = tracksWithChildren(3);
        toasterStore.set({});
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
    });

    it('prepares one atomic grouped command for the effective A, midpoint, and B notes', async () => {
        const kit = seedKit();
        expect(await exportPatternToTimeline(DEVICE_ID)).toEqual({ ok: true });
        let notes = bakedActions().filter((action) => action.type === 'addNotes');
        expect(notes).toHaveLength(1);
        expect(notes[0]?.payload.notes.map((note) => note.startBeat)).toEqual([0]);
        expect(mocks.batch.mock.calls[0]?.[1]).toMatchObject({ requireCompensation: true });

        mocks.batch.mockClear();
        kit.morph = { enabled: true, targetPatternId: 'B1', position: 0.5 };
        expect(await exportPatternToTimeline(DEVICE_ID)).toEqual({ ok: true });
        notes = bakedActions().filter((action) => action.type === 'addNotes');
        expect(notes[0]?.payload.notes.map((note) => note.startBeat)).toEqual([0, 0.25]);

        mocks.batch.mockClear();
        kit.morph.position = 1;
        expect(await exportPatternToTimeline(DEVICE_ID)).toEqual({ ok: true });
        notes = bakedActions().filter((action) => action.type === 'addNotes');
        expect(notes[0]?.payload.notes.map((note) => note.startBeat)).toEqual([0.25]);
    });

    it('uses the real A identity for B output groove and routes sparse pads to their own children', async () => {
        const kit = seedKit();
        kit.morph = { enabled: true, targetPatternId: 'B1', position: 1 };
        kit.patterns[1]!.tracks[2]!.steps[0]!.active = true;
        createGrooveTemplate({
            id: 'bake-pocket',
            name: 'Bake pocket',
            subdivision: '1/16',
            slots: [
                { index: 0, timingOffset: 0.2, dynamicsOffset: -0.1 },
                { index: 1, timingOffset: 0.2, dynamicsOffset: -0.1 },
            ],
            provenance: { type: 'user', sourceId: 'test' },
        });
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: `groove-consumer:${DEVICE_ID}:A1`,
            templateId: 'bake-pocket',
            amount: 1,
        });

        expect(await exportPatternToTimeline(DEVICE_ID)).toEqual({ ok: true });
        const actions = bakedActions();
        expect(actions.filter((action) => action.type === 'addClip').map((action) => action.payload.trackId)).toEqual([
            'child-0',
            'child-2',
        ]);
        const notes = actions.filter((action) => action.type === 'addNotes');
        expect(notes[0]?.payload.notes[0]).toMatchObject({ pitch: 36, startBeat: 0.3 });
        expect(notes[1]?.payload.notes[0]).toMatchObject({ pitch: 38, startBeat: 0.05 });
    });

    it('never invokes the batch when the pattern is absent or a groove is unresolvable', async () => {
        expect((await exportPatternToTimeline(DEVICE_ID)).ok).toBe(false);
        expect(mocks.batch).not.toHaveBeenCalled();

        const kit = seedKit();
        kit.patterns[0]!.tracks[2]!.steps[0]!.active = true;
        createGrooveTemplate({
            id: 'vanished-template',
            name: 'Vanished',
            subdivision: '1/16',
            slots: [{ index: 0, timingOffset: 0.1, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'test' },
        });
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: `groove-consumer:${DEVICE_ID}:A1`,
            templateId: 'vanished-template',
            amount: 1,
        });
        const groove = grooveTemplateStore.value!;
        grooveTemplateStore.set({
            ...groove,
            templates: groove.templates.filter((template) => template.id !== 'vanished-template'),
        });
        expect((await exportPatternToTimeline(DEVICE_ID)).ok).toBe(false);
        expect(mocks.batch).not.toHaveBeenCalled();
    });

    it('reports batch refusal instead of claiming a bake succeeded', async () => {
        seedKit();
        mocks.batch.mockResolvedValue({ status: 'rejected', reason: 'Locked project', actions: [] });
        expect(await exportPatternToTimeline(DEVICE_ID)).toEqual({ ok: false, message: 'Locked project' });
    });

    it('retains polymetric clip length and bakes swing, microtiming, and retrigger notes in the batch', async () => {
        const kit = seedKit();
        kit.morph = { enabled: false, targetPatternId: 'B1', position: 0 };
        kit.swing = 0.5;
        const a = kit.patterns[0]!;
        a.stepsPerBar = 4;
        a.bars = 2;
        const track = a.tracks[0]!;
        track.stepsOverride = 12;
        track.steps[0]!.active = false;
        track.steps[1] = {
            ...track.steps[1]!,
            active: true,
            velocity: 1,
            microTiming: 0.1,
            retriggerCount: 2,
        };

        expect(await exportPatternToTimeline(DEVICE_ID)).toEqual({ ok: true });
        const actions = bakedActions();
        const clip = actions.find((action) => action.type === 'addClip');
        const notes = actions.find((action) => action.type === 'addNotes');
        expect(clip?.payload.endBeat).toBe(12);
        expect(notes?.payload.notes).toHaveLength(3);
        expect(notes?.payload.notes[0]?.startBeat).toBeCloseTo(1.35, 10);
        expect(notes?.payload.notes[0]?.velocity).toBe(127);
        expect(notes?.payload.notes[1]?.velocity).toBe(Math.round(127 * (1 - 0.12)));
        expect(notes?.payload.notes[2]?.velocity).toBe(Math.round(127 * (1 - 0.24)));
    });

    it('extends a one-shot clip for its positively shifted final step', async () => {
        const kit = seedKit();
        kit.morph = { enabled: false, targetPatternId: 'B1', position: 0 };
        kit.swing = 1;
        const a = kit.patterns[0]!;
        a.stepsPerBar = 4;
        const track = a.tracks[0]!;
        track.steps[0]!.active = false;
        track.steps[3] = { ...track.steps[3]!, active: true, microTiming: 0.5 };

        expect(await exportPatternToTimeline(DEVICE_ID)).toEqual({ ok: true });
        const actions = bakedActions();
        expect(actions.find((action) => action.type === 'addNotes')?.payload.notes[0]?.startBeat).toBe(4);
        expect(actions.find((action) => action.type === 'addClip')?.payload.endBeat).toBe(4.9);
    });
});
