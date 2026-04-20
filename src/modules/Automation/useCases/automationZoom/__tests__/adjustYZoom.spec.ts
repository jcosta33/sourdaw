import { describe, it, expect } from 'vitest';

import * as subject from '../adjustYZoom';

describe('adjustYZoom', () => {
    it('should export adjustYZoom', () => {
        expect(subject.adjustYZoom).toBeDefined();
        const t = typeof subject.adjustYZoom;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
