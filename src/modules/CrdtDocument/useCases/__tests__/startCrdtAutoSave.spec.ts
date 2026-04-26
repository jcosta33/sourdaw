import { describe, it, expect } from 'vitest';

import * as subject from '../startCrdtAutoSave';

describe('startCrdtAutoSave', () => {
    it('should export startCrdtAutoSave', () => {
        expect(subject.startCrdtAutoSave).toBeDefined();
        const time = typeof subject.startCrdtAutoSave;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
