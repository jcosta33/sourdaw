import { describe, it, expect } from 'vitest';

import * as subject from '../removeSend';

describe('removeSend', () => {
    it('should export removeSend', () => {
        expect(subject.removeSend).toBeDefined();
        const time = typeof subject.removeSend;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
