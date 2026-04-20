import { describe, it, expect } from 'vitest';

import * as subject from '../setGrandBouleSoundboardSend';

describe('setGrandBouleSoundboardSend', () => {
    it('should export setGrandBouleSoundboardSend', () => {
        expect(subject.setGrandBouleSoundboardSend).toBeDefined();
        const t = typeof subject.setGrandBouleSoundboardSend;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
