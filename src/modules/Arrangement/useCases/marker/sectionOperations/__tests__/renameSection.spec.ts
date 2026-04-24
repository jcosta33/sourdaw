import { describe, it, expect } from 'vitest';

import * as subject from '../renameSection';

describe('renameSection', () => {
    it('should export renameSection', () => {
        expect(subject.renameSection).toBeDefined();
        const time = typeof subject.renameSection;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
