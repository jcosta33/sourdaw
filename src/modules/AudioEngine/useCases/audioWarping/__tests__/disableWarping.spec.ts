import { describe, it, expect } from 'vitest';

import * as subject from '../disableWarping';

describe('disableWarping', () => {
    it('should export disableWarping', () => {
        expect(subject.disableWarping).toBeDefined();
        const t = typeof subject.disableWarping;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
