import { describe, it, expect } from 'vitest';

import * as subject from '../setTrackListWidth';

describe('setTrackListWidth', () => {
    it('should export setTrackListWidth', () => {
        expect(subject.setTrackListWidth).toBeDefined();
        const time = typeof subject.setTrackListWidth;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
