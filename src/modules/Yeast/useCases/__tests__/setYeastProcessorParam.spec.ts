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
        ],
        uiLevel: 2 as const,
    },
}));

const commit = vi.hoisted(() => vi.fn());

vi.mock('../../stores/yeastStore', () => ({ yeastStore: store }));
vi.mock('../commitYeastProjection', () => ({ commitYeastProjection: commit }));

const { setYeastProcessorParam } = await import('../setYeastProcessorParam');

describe('setYeastProcessorParam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each(['learn', 'clear'])('does not persist the Chord Memory %s command as a parameter', (name) => {
        setYeastProcessorParam('cm-1', name, 1);

        expect(commit).not.toHaveBeenCalled();
        expect(store.value.processors[0]?.params).toEqual({ transpose_mode: 1 });
    });

    it('still persists durable Chord Memory parameters', () => {
        setYeastProcessorParam('cm-1', 'transpose_mode', 0);

        expect(commit).toHaveBeenCalledWith([
            {
                ...store.value.processors[0],
                params: { transpose_mode: 0 },
            },
        ]);
    });
});
