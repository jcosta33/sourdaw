import { describe, it, expect } from 'vitest';
import * as subject from '../setTrackListWidth';

describe('setTrackListWidth', () => {
    it('should export setTrackListWidth', () => {
        expect(subject.setTrackListWidth).toBeDefined();
        const t = typeof subject.setTrackListWidth;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
