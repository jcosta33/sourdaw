import { describe, it, expect } from 'vitest';

import { getAnalysisHandlers } from '../getAnalysisHandlers';

describe('getAnalysisHandlers', () => {
    it('returns a fresh map of mix-analysis command handlers', () => {
        const map = getAnalysisHandlers();
        expect(getAnalysisHandlers()).not.toBe(map);
    });

    it('exposes all six analysis action handlers', () => {
        const map = getAnalysisHandlers();
        const keys = Object.keys(map).sort();
        expect(keys).toEqual([
            'analyzeMix',
            'audioToMidi',
            'autoFixMix',
            'compareToReference',
            'detectKey',
            'detectTempo',
        ]);
    });

    it('every handler is a complete ActionHandler (execute + describe + undoable)', () => {
        const map = getAnalysisHandlers();
        for (const [key, handler] of Object.entries(map)) {
            expect(typeof handler.execute).toBe('function');
            expect(typeof handler.describe).toBe('function');
            expect(typeof handler.undoable).toBe('boolean');
            // Unused key variable check — reference it to satisfy lint.
            expect(key.length).toBeGreaterThan(0);
        }
    });

    it('every handler.describe returns an object with a non-empty label', () => {
        const map = getAnalysisHandlers();
        for (const handler of Object.values(map)) {
            const description = handler.describe({ type: 'analyzeMix' } as never);
            expect(description).toBeDefined();
            expect(typeof description.label).toBe('string');
            expect(description.label.length).toBeGreaterThan(0);
        }
    });

    it('all handlers are non-undoable (analysis is read-only)', () => {
        const map = getAnalysisHandlers();
        for (const handler of Object.values(map)) {
            expect(handler.undoable).toBe(false);
        }
    });
});
