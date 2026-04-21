import { describe, it, expect } from 'vitest';

import * as subject from '../adjustYZoom';

describe('adjustYZoom', () => {
    it('should export adjustYZoom', () => {
        expect(subject.adjustYZoom).toBeDefined();
        const time = typeof subject.adjustYZoom;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
