import { describe, it, expect } from 'vitest';

import * as subject from '../processOscMessage';

describe('processOscMessage', () => {
    it('should export processOscMessage', () => {
        expect(subject.processOscMessage).toBeDefined();
        const t = typeof subject.processOscMessage;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
