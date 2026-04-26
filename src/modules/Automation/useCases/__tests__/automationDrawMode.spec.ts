import { describe, it, expect } from 'vitest';

import * as subject from '../automationDrawMode';

describe('automationDrawMode', () => {
    it('should export beginDrawSession', () => {
        expect(subject.beginDrawSession).toBeDefined();
        const time = typeof subject.beginDrawSession;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export endDrawSession', () => {
        expect(subject.endDrawSession).toBeDefined();
        const time = typeof subject.endDrawSession;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export isDrawSessionActive', () => {
        expect(subject.isDrawSessionActive).toBeDefined();
        const time = typeof subject.isDrawSessionActive;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export paintDrawPoint', () => {
        expect(subject.paintDrawPoint).toBeDefined();
        const time = typeof subject.paintDrawPoint;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
