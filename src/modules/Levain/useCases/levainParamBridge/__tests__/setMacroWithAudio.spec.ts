import { describe, it, expect } from 'vitest';

import * as subject from '../setMacroWithAudio';

describe('setMacroWithAudio', () => {
    it('should export setMacroWithAudio', () => {
        expect(subject.setMacroWithAudio).toBeDefined();
        const t = typeof subject.setMacroWithAudio;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
