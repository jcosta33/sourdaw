import { describe, it, expect } from 'vitest';

import * as subject from '../trackTemplate';

describe('trackTemplate', () => {
    it('should export deleteTrackTemplate', () => {
        expect(subject.deleteTrackTemplate).toBeDefined();
        const t = typeof subject.deleteTrackTemplate;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export getTrackTemplates', () => {
        expect(subject.getTrackTemplates).toBeDefined();
        const t = typeof subject.getTrackTemplates;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export loadTrackTemplate', () => {
        expect(subject.loadTrackTemplate).toBeDefined();
        const t = typeof subject.loadTrackTemplate;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export saveTrackAsTemplate', () => {
        expect(subject.saveTrackAsTemplate).toBeDefined();
        const t = typeof subject.saveTrackAsTemplate;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
