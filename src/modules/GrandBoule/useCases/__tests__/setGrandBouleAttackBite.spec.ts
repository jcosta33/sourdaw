import { describe, it, expect } from 'vitest';

import * as subject from '../setGrandBouleAttackBite';

describe('setGrandBouleAttackBite', () => {
    it('should export setGrandBouleAttackBite', () => {
        expect(subject.setGrandBouleAttackBite).toBeDefined();
        const t = typeof subject.setGrandBouleAttackBite;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
