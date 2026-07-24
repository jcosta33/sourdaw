import { describe, expect, it } from 'vitest';

import { createSidechainRoute } from '../SidechainRoute';

describe('createSidechainRoute', () => {
    it('applies defaults for targetParameterId and gain', () => {
        const route = createSidechainRoute('src-track', 'tgt-track', 'dev-1');
        expect(route).toMatchObject({
            sourceTrackId: 'src-track',
            targetTrackId: 'tgt-track',
            targetDeviceId: 'dev-1',
            targetParameterId: 'threshold', // documented default
            gain: 1, // unity default
        });
        expect(route.id).toMatch(/^sidechain-[0-9a-f-]{36}$/);
    });

    it('honours explicit targetParameterId and gain overrides', () => {
        const route = createSidechainRoute('s', 't', 'd', 'ratio', 0.5);
        expect(route.targetParameterId).toBe('ratio');
        expect(route.gain).toBe(0.5);
    });

    it('generates a unique id per call', () => {
        const a = createSidechainRoute('s', 't', 'd');
        const b = createSidechainRoute('s', 't', 'd');
        expect(a.id).not.toBe(b.id);
    });
});
