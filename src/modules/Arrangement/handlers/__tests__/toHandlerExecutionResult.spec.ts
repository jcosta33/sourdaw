import { describe, expect, it } from 'vitest';

import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

describe('toHandlerExecutionResult', () => {
    it('maps a completed write to the written handler result', () => {
        expect(toHandlerExecutionResult(true)).toEqual({ status: 'written' });
    });

    it('maps a rejected write to the no-write handler result', () => {
        expect(toHandlerExecutionResult(false)).toEqual({ status: 'no-write' });
    });
});
