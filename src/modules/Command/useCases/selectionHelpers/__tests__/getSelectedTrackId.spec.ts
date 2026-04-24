import { describe, it, expect } from 'vitest';

import * as subject from '../getSelectedTrackId';

describe('getSelectedTrackId', () => {
    it('should export getSelectedTrackId', () => {
        expect(subject.getSelectedTrackId).toBeDefined();
        const time = typeof subject.getSelectedTrackId;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
