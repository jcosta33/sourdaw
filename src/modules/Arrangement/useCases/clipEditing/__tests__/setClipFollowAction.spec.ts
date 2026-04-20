import { describe, it, expect } from 'vitest';

import * as subject from '../setClipFollowAction';

describe('setClipFollowAction', () => {
    it('should export setClipFollowAction', () => {
        expect(subject.setClipFollowAction).toBeDefined();
        const t = typeof subject.setClipFollowAction;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
