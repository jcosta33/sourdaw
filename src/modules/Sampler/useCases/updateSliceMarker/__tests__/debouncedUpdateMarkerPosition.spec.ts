import { describe, it, expect } from 'vitest';
import * as subject from '../debouncedUpdateMarkerPosition';

describe('debouncedUpdateMarkerPosition', () => {
    it('should export debouncedUpdateMarkerPosition', () => {
        expect(subject.debouncedUpdateMarkerPosition).toBeDefined();
        const t = typeof subject.debouncedUpdateMarkerPosition;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
