import { describe, expect, it } from 'vitest';

import { createSidechainRoute } from '../SidechainRoute';

describe('createSidechainRoute', () => {
    it('builds a route with required fields and unique ids', () => {
        const alpha = createSidechainRoute('src-a', 'tgt-a', 'dev-a');
        const b = createSidechainRoute('src-b', 'tgt-b', 'dev-b', 'ratio', 0.5);

        expect(alpha.sourceTrackId).toBe('src-a');
        expect(alpha.targetTrackId).toBe('tgt-a');
        expect(alpha.targetDeviceId).toBe('dev-a');
        expect(alpha.targetParameterId).toBe('threshold');
        expect(alpha.gain).toBe(1);
        expect(alpha.id).toMatch(/^sidechain-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

        expect(b.targetParameterId).toBe('ratio');
        expect(b.gain).toBe(0.5);
        expect(b.id).not.toBe(alpha.id);
    });
});
