import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    setYeastRuntimeProjection: vi.fn(),
}));

vi.mock('../../stores/yeastStore', () => ({ yeastStore: store }));
vi.mock('../../engine/yeastRuntime', () => ({
    setYeastRuntimeProjection: runtimeMocks.setYeastRuntimeProjection,
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

        expect(runtimeMocks.setYeastRuntimeProjection).toHaveBeenCalledWith([
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
});
