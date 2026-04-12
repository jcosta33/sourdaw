import { describe, expect, it } from 'vitest';

import { createCompactFloatBuffer } from '../createCompactFloatBuffer';

describe('createCompactFloatBuffer', () => {
    it('should allocate a typed array of the requested length', () => {
        const buf = createCompactFloatBuffer({ length: 8 });
        expect(buf.length).toBe(8);
    });

    it('should support zero-length buffers', () => {
        const buf = createCompactFloatBuffer({ length: 0 });
        expect(buf.length).toBe(0);
    });

    it('should fill the buffer when fill is provided', () => {
        const buf = createCompactFloatBuffer({ length: 4, fill: 0.25 });
        expect(buf.every((x) => x === 0.25)).toBe(true);
    });
});
