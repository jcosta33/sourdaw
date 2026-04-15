import { describe, it, expect } from 'vitest';
import * as subject from '../smartLoopPoints';

describe('smartLoopPoints', () => {
    it('should export detectAndApplyLoopPoints', () => {
        expect(subject.detectAndApplyLoopPoints).toBeDefined();
        const t = typeof subject.detectAndApplyLoopPoints;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
