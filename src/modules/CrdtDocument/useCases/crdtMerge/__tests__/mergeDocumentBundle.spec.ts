import { describe, it, expect } from 'vitest';

import * as subject from '../mergeDocumentBundle';

describe('mergeDocumentBundle', () => {
    it('should export mergeDocumentBundle', () => {
        expect(subject.mergeDocumentBundle).toBeDefined();
        const time = typeof subject.mergeDocumentBundle;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
