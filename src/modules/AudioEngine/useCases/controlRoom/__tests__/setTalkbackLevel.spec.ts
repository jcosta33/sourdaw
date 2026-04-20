import { describe, it, expect } from 'vitest';

import * as subject from '../setTalkbackLevel';

describe('setTalkbackLevel', () => {
    it('should export setTalkbackLevel', () => {
        expect(subject.setTalkbackLevel).toBeDefined();
        const t = typeof subject.setTalkbackLevel;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
