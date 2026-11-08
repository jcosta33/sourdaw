import { beforeEach, describe, expect, it, vi } from 'vitest';

import { yeastStore } from '../../stores/yeastStore';
import { addYeastProcessor } from '../addYeastProcessor';

const commit = vi.hoisted(() => vi.fn<(processors: unknown) => boolean>());
vi.mock('../commitYeastProjection', () => ({ commitYeastProjection: commit }));

describe('addYeastProcessor', () => {
    beforeEach(() => {
        commit.mockReset();
        yeastStore.set({ processors: [], uiLevel: 3 });
    });

    it.each([true, false])(
        'forwards cleanup=%s from the owning projection commit without losing the added identity',
        (changed) => {
            commit.mockReturnValue(changed);
            expect(addYeastProcessor('arpeggiator', 'added-arp', 'Custom arp')).toBe(changed);
            expect(commit).toHaveBeenCalledExactlyOnceWith([
                { id: 'added-arp', type: 'arpeggiator', name: 'Custom arp', bypassed: false, params: {} },
            ]);
        }
    );
});
