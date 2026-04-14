import { describe, it, expect } from 'vitest';
import * as subject from '../toggleClipInSelection';

describe('toggleClipInSelection', () => {
    it('should export toggleClipInSelection', () => {
        expect(subject.toggleClipInSelection).toBeDefined();
        const t = typeof subject.toggleClipInSelection;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
