import { describe, it, expect } from 'vitest';

import * as subject from '../builtinSynth';

describe('builtinSynth', () => {
    it('should export getSynthParamsFromDevices', () => {
        expect(subject.getSynthParamsFromDevices).toBeDefined();
        const t = typeof subject.getSynthParamsFromDevices;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export scheduleNote', () => {
        expect(subject.scheduleNote).toBeDefined();
        const t = typeof subject.scheduleNote;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export scheduleNoteOffline', () => {
        expect(subject.scheduleNoteOffline).toBeDefined();
        const t = typeof subject.scheduleNoteOffline;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
