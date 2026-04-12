import { describe, expect, it } from 'vitest';

import { createSidechainRoute } from '../SidechainRoute';

describe('createSidechainRoute', () => {
    it('builds a route with required fields and unique ids', () => {
        const a = createSidechainRoute('src-a', 'tgt-a', 'dev-a');
        const b = createSidechainRoute('src-b', 'tgt-b', 'dev-b', 'ratio', 0.5);

        expect(a.sourceTrackId).toBe('src-a');
        expect(a.targetTrackId).toBe('tgt-a');
        expect(a.targetDeviceId).toBe('dev-a');
        expect(a.targetParameterId).toBe('threshold');
        expect(a.gain).toBe(1);
        expect(a.id).toMatch(/^sidechain-\d+$/);

        expect(b.targetParameterId).toBe('ratio');
        expect(b.gain).toBe(0.5);
        expect(b.id).not.toBe(a.id);
    });
});
