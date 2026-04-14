import { describe, it, expect } from 'vitest';
import * as subject from '../automationDrawMode';

describe('automationDrawMode', () => {
    it('should export beginDrawSession', () => {
        expect(subject.beginDrawSession).toBeDefined();
        const t = typeof subject.beginDrawSession;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export endDrawSession', () => {
        expect(subject.endDrawSession).toBeDefined();
        const t = typeof subject.endDrawSession;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export isDrawSessionActive', () => {
        expect(subject.isDrawSessionActive).toBeDefined();
        const t = typeof subject.isDrawSessionActive;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export paintDrawPoint', () => {
        expect(subject.paintDrawPoint).toBeDefined();
        const t = typeof subject.paintDrawPoint;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
