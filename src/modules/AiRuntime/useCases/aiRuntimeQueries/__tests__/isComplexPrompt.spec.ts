import { describe, it, expect } from 'vitest';

import { isComplexPrompt } from '../isComplexPrompt';

describe('isComplexPrompt', () => {
    it('should identify prompts that require multi-action planning', () => {
        expect(isComplexPrompt('create 4 tracks')).toBe(true);
    });

    it('should not classify a simple targeted command as complex', () => {
        expect(isComplexPrompt('mute track')).toBe(false);
    });
});
