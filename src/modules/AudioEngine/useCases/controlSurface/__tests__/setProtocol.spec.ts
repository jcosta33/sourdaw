import { describe, it, expect } from 'vitest';

import * as subject from '../setProtocol';

describe('setProtocol', () => {
    it('should export setProtocol', () => {
        expect(subject.setProtocol).toBeDefined();
        const time = typeof subject.setProtocol;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
