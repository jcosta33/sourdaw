import { describe, it, expect } from 'vitest';

import * as subject from '../processAudioIPC';

describe('processAudioIPC', () => {
    it('should export processAudioIPC', () => {
        expect(subject.processAudioIPC).toBeDefined();
        const t = typeof subject.processAudioIPC;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
