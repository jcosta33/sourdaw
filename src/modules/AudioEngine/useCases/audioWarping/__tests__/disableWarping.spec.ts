import { describe, it, expect } from 'vitest';

import * as subject from '../disableWarping';

describe('disableWarping', () => {
    it('should export disableWarping', () => {
        expect(subject.disableWarping).toBeDefined();
        const time = typeof subject.disableWarping;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
