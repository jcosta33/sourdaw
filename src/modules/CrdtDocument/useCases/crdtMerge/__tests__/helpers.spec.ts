import { describe, it, expect } from 'vitest';

import * as subject from '../helpers';

describe('helpers', () => {
    it('should export mergeDocumentBundleFromRepo', () => {
        expect(subject.mergeDocumentBundleFromRepo).toBeDefined();
        const t = typeof subject.mergeDocumentBundleFromRepo;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
