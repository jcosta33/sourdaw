import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { YeastPreviewRevision } from '../../stores/yeastPreviewRevision';

const store = vi.hoisted(() => ({
    value: {
        processors: [
            {
                id: 'cm-1',
                type: 'chordMemory' as const,
                name: 'Chord Memory',
                bypassed: false,
                params: { transpose_mode: 1 },
            },
            {
                id: 'groove-1',
                type: 'groove' as const,
                name: 'Groove',
                bypassed: false,
                params: {},
            },
        ],
        uiLevel: 2 as const,
    },
}));

const commit = vi.hoisted(() => vi.fn());
const grooveMocks = vi.hoisted(() => ({ setYeastGrooveTemplate: vi.fn() }));
const runtimeMocks = vi.hoisted(() => ({
    createYeastRuntimeProjection: vi.fn(() => [
        {
            id: 'groove-1',
            type: 'groove',
            bypassed: false,
            params: { groove_amount: 0.5 },
        },
    ]),
    applyYeastRuntimeProjection: vi.fn((): Promise<void> => Promise.resolve()),
}));

vi.mock('../../stores/yeastStore', () => ({ yeastStore: store }));
vi.mock('../../engine/yeastRuntime', () => ({
    applyYeastRuntimeProjection: runtimeMocks.applyYeastRuntimeProjection,
}));
vi.mock('../commitYeastProjection', () => ({ commitYeastProjection: commit }));
vi.mock('../createYeastRuntimeProjection', () => ({
    createYeastRuntimeProjection: runtimeMocks.createYeastRuntimeProjection,
}));
vi.mock('../getYeastGrooveAssignment', () => ({
    getYeastGrooveAssignment: () => ({ templateId: 'pocket-1', amount: 0.5 }),
}));
vi.mock('../setYeastGrooveTemplate', () => ({ setYeastGrooveTemplate: grooveMocks.setYeastGrooveTemplate }));

const { setYeastProcessorParam } = await import('../setYeastProcessorParam');
const { subscribeYeastPreviewRevision } = await import('../../stores/yeastPreviewRevision');

describe('setYeastProcessorParam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each(['learn', 'clear'])('does not persist the Chord Memory %s command as a parameter', async (name) => {
        await setYeastProcessorParam('cm-1', name, 1);

        expect(commit).not.toHaveBeenCalled();
        expect(store.value.processors[0]?.params).toEqual({ transpose_mode: 1 });
    });

    it('still persists durable Chord Memory parameters', async () => {
        await setYeastProcessorParam('cm-1', 'transpose_mode', 0);

        expect(commit).toHaveBeenCalledWith([
            {
                ...store.value.processors[0],
                params: { transpose_mode: 0 },
            },
            store.value.processors[1],
        ]);
    });

    it('should route groove amount through the MIDI-owned assignment without changing Yeast storage', async () => {
        await setYeastProcessorParam('groove-1', 'amount', 0.75);

        expect(grooveMocks.setYeastGrooveTemplate).toHaveBeenCalledWith('groove-1', 'pocket-1', 0.75);
        expect(commit).not.toHaveBeenCalled();
        expect(store.value.processors[1]?.params).toEqual({});
    });

    it('returns a rejected groove assignment so the caller can observe the failure', async () => {
        const error = new Error('assignment failed');
        grooveMocks.setYeastGrooveTemplate.mockRejectedValueOnce(error);

        await expect(setYeastProcessorParam('groove-1', 'amount', 0.75)).rejects.toBe(error);
    });

    it('previews a transient groove amount without creating an assignment or durable store write', async () => {
        await setYeastProcessorParam('groove-1', 'amount', 0.75, true);

        expect(runtimeMocks.applyYeastRuntimeProjection).toHaveBeenCalledWith([
            {
                id: 'groove-1',
                type: 'groove',
                bypassed: false,
                params: { groove_amount: 0.75 },
            },
        ]);
        expect(grooveMocks.setYeastGrooveTemplate).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        expect(store.value.processors[1]?.params).toEqual({});
    });

    it('publishes paired pending and applied revisions for durable and transient updates', async () => {
        const revisions: YeastPreviewRevision[] = [];
        const unsubscribe = subscribeYeastPreviewRevision((revision) => {
            revisions.push(revision);
        });

        await setYeastProcessorParam('cm-1', 'transpose_mode', 0);
        await setYeastProcessorParam('groove-1', 'amount', 0.75, true);
        unsubscribe();

        expect(revisions).toHaveLength(4);
        expect(revisions[0]).toMatchObject({
            processorId: 'cm-1',
            parameterName: 'transpose_mode',
            transient: false,
            phase: 'pending',
        });
        expect(revisions[1]).toMatchObject({
            processorId: 'cm-1',
            parameterName: 'transpose_mode',
            transient: false,
            phase: 'applied',
        });
        expect(revisions[2]).toMatchObject({
            processorId: 'groove-1',
            parameterName: 'amount',
            transient: true,
            phase: 'pending',
        });
        expect(revisions[3]).toMatchObject({
            processorId: 'groove-1',
            parameterName: 'amount',
            transient: true,
            phase: 'applied',
        });
        expect(revisions[0]!.revision).toBeGreaterThan(0);
        expect(revisions[1]!.revision).toBe(revisions[0]!.revision);
        expect(revisions[2]!.revision).toBe(revisions[0]!.revision + 1);
        expect(revisions[3]!.revision).toBe(revisions[2]!.revision);
    });

    it.each([
        { updateKind: 'durable', processorId: 'cm-1', parameterName: 'transpose_mode', value: 0, transient: false },
        { updateKind: 'transient', processorId: 'groove-1', parameterName: 'amount', value: 0.75, transient: true },
    ])('suspends $updateKind snapshots before runtime acknowledgement', async (input) => {
        const acknowledgement = Promise.withResolvers<void>();
        runtimeMocks.applyYeastRuntimeProjection.mockReturnValueOnce(acknowledgement.promise);
        const revisions: YeastPreviewRevision[] = [];
        const unsubscribe = subscribeYeastPreviewRevision((revision) => {
            revisions.push(revision);
        });

        const update = setYeastProcessorParam(input.processorId, input.parameterName, input.value, input.transient);
        expect(revisions).toHaveLength(1);
        expect(revisions[0]).toMatchObject({ phase: 'pending', transient: input.transient });

        acknowledgement.resolve();
        await update;
        unsubscribe();

        expect(revisions).toHaveLength(2);
        expect(revisions[1]).toMatchObject({ phase: 'applied', transient: input.transient });
        expect(revisions[1]!.revision).toBe(revisions[0]!.revision);
    });

    it('keeps the preview suspended when the runtime rejects a projection', async () => {
        const error = new Error('projection failed');
        runtimeMocks.applyYeastRuntimeProjection.mockRejectedValueOnce(error);
        const revisions: YeastPreviewRevision[] = [];
        const unsubscribe = subscribeYeastPreviewRevision((revision) => {
            revisions.push(revision);
        });

        await expect(setYeastProcessorParam('groove-1', 'amount', 0.75, true)).rejects.toBe(error);
        unsubscribe();

        expect(revisions).toHaveLength(1);
        expect(revisions[0]).toMatchObject({
            processorId: 'groove-1',
            phase: 'pending',
            transient: true,
        });
    });
});
