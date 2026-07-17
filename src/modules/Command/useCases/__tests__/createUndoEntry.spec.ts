import { describe, it, expect } from 'vitest';

import { createUndoEntry } from '../createUndoEntry';

import type { AppAction } from '#/utils/handlerContract';

const action: AppAction = { type: 'addTrack', payload: { name: 'Test', kind: 'midi' } } as never;
const inverse: AppAction = { type: 'removeTrack', payload: { trackId: 't1' } } as never;

describe('createUndoEntry', () => {
    it('creates entry with unique id', () => {
        const entry = createUndoEntry('Add track', action, inverse);
        expect(entry.id).toMatch(/^undo-/);
        const entry2 = createUndoEntry('Add track', action, inverse);
        expect(entry.id).not.toBe(entry2.id);
    });

    it('stores label, action, and inverseAction', () => {
        const entry = createUndoEntry('Add track', action, inverse);
        expect(entry.label).toBe('Add track');
        expect(entry.action).toBe(action);
        expect(entry.inverseAction).toBe(inverse);
    });

    it('defaults source to manual', () => {
        const entry = createUndoEntry('Test', action, null);
        expect(entry.source).toBe('manual');
    });

    it('accepts source from caller', () => {
        const entry = createUndoEntry('Test', action, null, 'ai');
        expect(entry.source).toBe('ai');
    });

    it('accepts null inverseAction', () => {
        const entry = createUndoEntry('Test', action, null);
        expect(entry.inverseAction).toBeNull();
    });

    it('sets timestamp', () => {
        const before = Date.now();
        const entry = createUndoEntry('Test', action, null);
        const after = Date.now();
        expect(entry.timestamp).toBeGreaterThanOrEqual(before);
        expect(entry.timestamp).toBeLessThanOrEqual(after);
    });
});
