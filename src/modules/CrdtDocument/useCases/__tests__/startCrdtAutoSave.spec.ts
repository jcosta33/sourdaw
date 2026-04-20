import { describe, it, expect } from 'vitest';

import * as subject from '../startCrdtAutoSave';

describe('startCrdtAutoSave', () => {
    it('should export startCrdtAutoSave', () => {
        expect(subject.startCrdtAutoSave).toBeDefined();
        const t = typeof subject.startCrdtAutoSave;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
