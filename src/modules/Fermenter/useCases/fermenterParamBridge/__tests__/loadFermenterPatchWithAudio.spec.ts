import { describe, it, expect } from 'vitest';

import * as subject from '../loadFermenterPatchWithAudio';

describe('loadFermenterPatchWithAudio', () => {
    it('should export loadFermenterPatchWithAudio', () => {
        expect(subject.loadFermenterPatchWithAudio).toBeDefined();
        const t = typeof subject.loadFermenterPatchWithAudio;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
