import { describe, expect, it } from 'vitest';

import { isSameProcessorSnapshot, isSameSnapshot } from '../rackState';

describe('isSameSnapshot', () => {
    it('accepts reordered processor and arp parameter keys', () => {
        expect(
            isSameSnapshot(
                { params: { pattern_0: 0, pattern_1: 1 }, id: 'processor-1' },
                { id: 'processor-1', params: { pattern_1: 1, pattern_0: 0 } }
            )
        ).toBe(true);
    });

    it('refuses changed processor parameters and reordered arp steps', () => {
        expect(isSameSnapshot({ params: { amount: 0.5 } }, { params: { amount: 0.75 } })).toBe(false);
        expect(isSameSnapshot([{ step: 0 }, { step: 1 }], [{ step: 1 }, { step: 0 }])).toBe(false);
    });
});

describe('isSameProcessorSnapshot', () => {
    it('treats an omitted durable empty params map as equivalent', () => {
        expect(
            isSameProcessorSnapshot(
                { id: 'processor-1', type: 'groove', name: 'Groove', bypassed: false, params: {} },
                { id: 'processor-1', type: 'groove', name: 'Groove', bypassed: false }
            )
        ).toBe(true);
    });

    it('refuses changed nonempty processor parameters', () => {
        expect(
            isSameProcessorSnapshot(
                { id: 'processor-1', type: 'groove', name: 'Groove', bypassed: false, params: { amount: 0.5 } },
                { id: 'processor-1', type: 'groove', name: 'Groove', bypassed: false, params: { amount: 0.75 } }
            )
        ).toBe(false);
    });
});
