import { describe, it, expect } from 'vitest';

import * as subject from '../setFormantPreservation';

describe('setFormantPreservation', () => {
    it('should export setFormantPreservation', () => {
        expect(subject.setFormantPreservation).toBeDefined();
        const time = typeof subject.setFormantPreservation;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
