import { describe, it, expect } from 'vitest';

import * as subject from '../processOscMessage';

describe('processOscMessage', () => {
    it('should export processOscMessage', () => {
        expect(subject.processOscMessage).toBeDefined();
        const time = typeof subject.processOscMessage;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
