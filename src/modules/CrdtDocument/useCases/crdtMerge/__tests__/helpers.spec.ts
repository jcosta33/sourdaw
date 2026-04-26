import { describe, it, expect } from 'vitest';

import * as subject from '../helpers';

describe('helpers', () => {
    it('should export mergeDocumentBundleFromRepo', () => {
        expect(subject.mergeDocumentBundleFromRepo).toBeDefined();
        const time = typeof subject.mergeDocumentBundleFromRepo;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
