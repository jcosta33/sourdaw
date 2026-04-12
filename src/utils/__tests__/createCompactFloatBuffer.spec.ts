import { describe, it, expect } from 'vitest';

import { createCompactFloatBuffer } from '../createCompactFloatBuffer';

describe('createCompactFloatBuffer', () => {
    it('should create a typed array of the requested length', () => {
        const buf = createCompactFloatBuffer({ length: 4 });
        expect(buf).toHaveLength(4);
        expect(buf instanceof Float32Array).toBe(true);
    });

    it('should fill when fill is provided', () => {
        const buf = createCompactFloatBuffer({ length: 3, fill: 0.5 });
        expect(buf[0]).toBe(0.5);
        expect(buf[1]).toBe(0.5);
        expect(buf[2]).toBe(0.5);
    });
});
