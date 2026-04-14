import { describe, it, expect } from 'vitest';
import * as subject from '../setFormantPreservation';

describe('setFormantPreservation', () => {
    it('should export setFormantPreservation', () => {
        expect(subject.setFormantPreservation).toBeDefined();
        const t = typeof subject.setFormantPreservation;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
