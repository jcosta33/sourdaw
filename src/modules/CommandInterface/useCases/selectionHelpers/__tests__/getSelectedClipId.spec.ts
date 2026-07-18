import { describe, it, expect } from 'vitest';

import * as subject from '../getSelectedClipId';

describe('getSelectedClipId', () => {
    it('should export getSelectedClipId', () => {
        expect(subject.getSelectedClipId).toBeDefined();
        const time = typeof subject.getSelectedClipId;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
