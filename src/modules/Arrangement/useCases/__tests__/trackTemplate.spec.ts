import { describe, it, expect } from 'vitest';

import * as subject from '../trackTemplate';

describe('trackTemplate', () => {
    it('should export deleteTrackTemplate', () => {
        expect(subject.deleteTrackTemplate).toBeDefined();
        const time = typeof subject.deleteTrackTemplate;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export getTrackTemplates', () => {
        expect(subject.getTrackTemplates).toBeDefined();
        const time = typeof subject.getTrackTemplates;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export loadTrackTemplate', () => {
        expect(subject.loadTrackTemplate).toBeDefined();
        const time = typeof subject.loadTrackTemplate;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export saveTrackAsTemplate', () => {
        expect(subject.saveTrackAsTemplate).toBeDefined();
        const time = typeof subject.saveTrackAsTemplate;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
