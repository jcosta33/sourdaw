import { describe, it, expect } from 'vitest';

import * as subject from '../createSweetDreamsDemo';

describe('createSweetDreamsDemo', () => {
    it('should export demo_SweetDreams', () => {
        expect(subject.demo_SweetDreams).toBeDefined();
        const t = typeof subject.demo_SweetDreams;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
