import { describe, it, expect } from 'vitest';

import * as subject from '../sendHumanizeToEngine';

describe('sendHumanizeToEngine', () => {
    it('should export sendHumanizeToEngine', () => {
        expect(subject.sendHumanizeToEngine).toBeDefined();
        const t = typeof subject.sendHumanizeToEngine;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
