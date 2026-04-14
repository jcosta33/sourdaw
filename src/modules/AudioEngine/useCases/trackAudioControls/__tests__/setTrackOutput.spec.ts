import { describe, it, expect } from 'vitest';
import * as subject from '../setTrackOutput';

describe('setTrackOutput', () => {
    it('should export setTrackOutput', () => {
        expect(subject.setTrackOutput).toBeDefined();
        const t = typeof subject.setTrackOutput;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
