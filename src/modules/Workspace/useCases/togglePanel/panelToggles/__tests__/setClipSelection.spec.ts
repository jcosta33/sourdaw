import { describe, it, expect } from 'vitest';

import * as subject from '../setClipSelection';

describe('setClipSelection', () => {
    it('should export setClipSelection', () => {
        expect(subject.setClipSelection).toBeDefined();
        const time = typeof subject.setClipSelection;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
