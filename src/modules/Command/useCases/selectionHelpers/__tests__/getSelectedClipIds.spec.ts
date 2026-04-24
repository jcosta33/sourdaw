import { describe, it, expect } from 'vitest';

import * as subject from '../getSelectedClipIds';

describe('getSelectedClipIds', () => {
    it('should export getSelectedClipIds', () => {
        expect(subject.getSelectedClipIds).toBeDefined();
        const time = typeof subject.getSelectedClipIds;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
