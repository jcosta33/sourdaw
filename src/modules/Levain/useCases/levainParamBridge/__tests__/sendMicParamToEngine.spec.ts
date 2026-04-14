import { describe, it, expect } from 'vitest';
import * as subject from '../sendMicParamToEngine';

describe('sendMicParamToEngine', () => {
    it('should export sendMicParamToEngine', () => {
        expect(subject.sendMicParamToEngine).toBeDefined();
        const t = typeof subject.sendMicParamToEngine;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
