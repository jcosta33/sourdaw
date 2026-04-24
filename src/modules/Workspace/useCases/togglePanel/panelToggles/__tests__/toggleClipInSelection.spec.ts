import { describe, it, expect } from 'vitest';

import * as subject from '../toggleClipInSelection';

describe('toggleClipInSelection', () => {
    it('should export toggleClipInSelection', () => {
        expect(subject.toggleClipInSelection).toBeDefined();
        const time = typeof subject.toggleClipInSelection;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
