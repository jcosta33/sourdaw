import { describe, it, expect } from 'vitest';
import * as subject from '../sendLegatoEnabledToEngine';

describe('sendLegatoEnabledToEngine', () => {
    it('should export sendLegatoEnabledToEngine', () => {
        expect(subject.sendLegatoEnabledToEngine).toBeDefined();
        const t = typeof subject.sendLegatoEnabledToEngine;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
