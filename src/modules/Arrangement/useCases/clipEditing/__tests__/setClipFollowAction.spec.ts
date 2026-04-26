import { describe, it, expect } from 'vitest';

import * as subject from '../setClipFollowAction';

describe('setClipFollowAction', () => {
    it('should export setClipFollowAction', () => {
        expect(subject.setClipFollowAction).toBeDefined();
        const time = typeof subject.setClipFollowAction;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
