import { describe, it, expect } from 'vitest';

import * as subject from '../scheduleDrumKitNote';

describe('scheduleDrumKitNote', () => {
    it('should export findVoiceByNote', () => {
        expect(subject.findVoiceByNote).toBeDefined();
        const t = typeof subject.findVoiceByNote;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export scheduleDrumKitNote', () => {
        expect(subject.scheduleDrumKitNote).toBeDefined();
        const t = typeof subject.scheduleDrumKitNote;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
