import { describe, it, expect } from 'vitest';

import * as subject from '../getSelectedTrackId';

describe('getSelectedTrackId', () => {
    it('should export getSelectedTrackId', () => {
        expect(subject.getSelectedTrackId).toBeDefined();
        const t = typeof subject.getSelectedTrackId;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
