import { describe, it, expect } from 'vitest';

import * as subject from '../processAudioIPC';

describe('processAudioIPC', () => {
    it('should export processAudioIPC', () => {
        expect(subject.processAudioIPC).toBeDefined();
        const time = typeof subject.processAudioIPC;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
