import { describe, it, expect } from 'vitest';

import * as subject from '../mergeDocumentBundle';

describe('mergeDocumentBundle', () => {
    it('should export mergeDocumentBundle', () => {
        expect(subject.mergeDocumentBundle).toBeDefined();
        const t = typeof subject.mergeDocumentBundle;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
