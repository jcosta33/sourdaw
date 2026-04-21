import { describe, it, expect } from 'vitest';

import * as subject from '../createSweetDreamsDemo';

describe('createSweetDreamsDemo', () => {
    it('should export demo_SweetDreams', () => {
        expect(subject.demo_SweetDreams).toBeDefined();
        const time = typeof subject.demo_SweetDreams;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
