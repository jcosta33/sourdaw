import { describe, it, expect } from 'vitest';

import * as subject from '../getAllClipIds';

describe('getAllClipIds', () => {
    it('should export getAllClipIds', () => {
        expect(subject.getAllClipIds).toBeDefined();
        const time = typeof subject.getAllClipIds;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
