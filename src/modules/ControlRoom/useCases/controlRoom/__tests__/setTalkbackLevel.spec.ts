import { describe, it, expect } from 'vitest';

import * as subject from '../setTalkbackLevel';

describe('setTalkbackLevel', () => {
    it('should export setTalkbackLevel', () => {
        expect(subject.setTalkbackLevel).toBeDefined();
        const time = typeof subject.setTalkbackLevel;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
