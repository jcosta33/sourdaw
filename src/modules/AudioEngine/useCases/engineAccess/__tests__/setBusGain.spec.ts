import { describe, it, expect } from 'vitest';
import * as subject from '../setBusGain';

describe('setBusGain', () => {
    it('should export setBusGain', () => {
        expect(subject.setBusGain).toBeDefined();
        const t = typeof subject.setBusGain;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
