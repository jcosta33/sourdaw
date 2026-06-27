import { describe, it, expect } from 'vitest';

import { createCompactFloatBuffer } from '../createCompactFloatBuffer';

describe('createCompactFloatBuffer', () => {
    it('should create a typed array of the requested length', () => {
        const buffer = createCompactFloatBuffer({ length: 4 });
        expect(buffer).toHaveLength(4);
        expect(ArrayBuffer.isView(buffer)).toBe(true);
        expect([2, 4]).toContain(buffer.BYTES_PER_ELEMENT);
    });

    it('should fill when fill is provided', () => {
        const buffer = createCompactFloatBuffer({ length: 3, fill: 0.5 });
        expect(buffer[0]).toBe(0.5);
        expect(buffer[1]).toBe(0.5);
        expect(buffer[2]).toBe(0.5);
    });
});
