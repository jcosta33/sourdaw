import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { YeastProcessorInfo } from '../../stores/yeastStore';

const store = vi.hoisted(() => ({
    value: {
        processors: [
            {
                id: 'arp-1',
                type: 'arpeggiator' as const,
                name: 'Arp',
                bypassed: false,
                params: { mode: 0 },
            },
            {
                id: 'trans-1',
                type: 'transposer' as const,
                name: 'Transposer',
                bypassed: true,
                params: { semitones: 12 },
            },
        ],
        uiLevel: 2 as const,
    },
}));

const commit = vi.hoisted(() => vi.fn<(processors: readonly YeastProcessorInfo[]) => void>());

vi.mock('../../stores/yeastStore', () => ({ yeastStore: store }));
vi.mock('../commitYeastProjection', () => ({ commitYeastProjection: commit }));

const { setYeastProcessorBypass } = await import('../setYeastProcessorBypass');

describe('setYeastProcessorBypass', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('commits the processor list with the target processor bypassed', () => {
        setYeastProcessorBypass('arp-1', true);

        expect(commit).toHaveBeenCalledTimes(1);
        const committed = commit.mock.calls[0]?.[0];
        // Only the targeted processor's bypassed flag flips; the other is untouched.
        expect(committed).toEqual([{ ...store.value.processors[0]!, bypassed: true }, store.value.processors[1]]);
    });

    it('re-enables a bypassed processor', () => {
        setYeastProcessorBypass('trans-1', false);

        const committed = commit.mock.calls[0]?.[0];
        expect(committed).toEqual([store.value.processors[0], { ...store.value.processors[1]!, bypassed: false }]);
    });

    it('is a no-op when the processor id is not found', () => {
        setYeastProcessorBypass('does-not-exist', true);
        expect(commit).not.toHaveBeenCalled();
    });

    it('is a no-op when the store has no value', () => {
        const previous = store.value;
        store.value = undefined as unknown as typeof store.value;
        try {
            setYeastProcessorBypass('arp-1', true);
            expect(commit).not.toHaveBeenCalled();
        } finally {
            store.value = previous;
        }
    });
});
