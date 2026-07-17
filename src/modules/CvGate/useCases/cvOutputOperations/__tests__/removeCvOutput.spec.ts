import { describe, it, expect } from 'vitest';

import * as subject from '../removeCvOutput';

describe('removeCvOutput', () => {
    it('should export removeCvOutput', () => {
        expect(subject.removeCvOutput).toBeDefined();
        const t = typeof subject.removeCvOutput;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
