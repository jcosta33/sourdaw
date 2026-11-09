import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PROCESSOR_PARAM_DEFAULTS } from '../../models/ProcessorCatalog';
import { yeastStore, type YeastProcessorInfo } from '../../stores/yeastStore';
import { addYeastProcessor } from '../addYeastProcessor';

const commit = vi.hoisted(() => vi.fn<(processors: YeastProcessorInfo[]) => boolean>());
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
                {
                    id: 'added-arp',
                    type: 'arpeggiator',
                    name: 'Custom arp',
                    bypassed: false,
                    params: PROCESSOR_PARAM_DEFAULTS.arpeggiator,
                },
            ]);
            expect(commit.mock.calls[0]?.[0]?.[0]?.params).not.toBe(PROCESSOR_PARAM_DEFAULTS.arpeggiator);
        }
    );

    it('replays an owner-recorded empty initial map without changing non-Arpeggiator creation', () => {
        commit.mockReturnValue(false);
        addYeastProcessor('arpeggiator', 'old-arp', 'Old arp', {});
        expect(commit).toHaveBeenLastCalledWith([
            { id: 'old-arp', type: 'arpeggiator', name: 'Old arp', bypassed: false, params: {} },
        ]);

        addYeastProcessor('chord', 'new-chord', 'Chord');
        expect(commit).toHaveBeenLastCalledWith([
            { id: 'new-chord', type: 'chord', name: 'Chord', bypassed: false, params: {} },
        ]);
    });
});
