import { describe, it, expect, vi } from 'vitest';

import {
    createUndoEntry,
    createCallbackUndoEntry,
    generateGroupId,
    isActionEntry,
    type AppAction,
} from '../commandQueries';

describe('commandQueries (undo helpers)', () => {
    it('should build an action undo entry with sequential ids and the given source', () => {
        const action: AppAction = { type: 'removeAllTracks' };
        const inverse: AppAction = { type: 'togglePlayback' };
        vi.spyOn(Date, 'now').mockReturnValue(9_000_001);

        const a = createUndoEntry('Test', action, inverse, 'voice');
        const b = createUndoEntry('Test 2', action, null, 'manual');

        expect(a.id).toMatch(/^undo-[a-f0-9]{8}$/i);
        expect(b.id).toMatch(/^undo-[a-f0-9]{8}$/i);
        expect(a.id).not.toBe(b.id);
        expect(a).toMatchObject({
            kind: 'action',
            label: 'Test',
            action,
            inverseAction: inverse,
            timestamp: 9_000_001,
            source: 'voice',
        });
        expect(b.source).toBe('manual');
    });

    it('should default undo source to manual', () => {
        const action: AppAction = { type: 'stopPlayback' };
        const entry = createUndoEntry('x', action, null);
        expect(entry.source).toBe('manual');
    });

    it('should build a callback undo entry with undo/redo fns', () => {
        const undo = vi.fn();
        const redo = vi.fn();
        const entry = createCallbackUndoEntry('cb', undo, redo, 'ai');
        expect(entry.kind).toBe('callback');
        expect(entry.undo).toBe(undo);
        expect(entry.redo).toBe(redo);
        expect(entry.source).toBe('ai');
        entry.undo();
        entry.redo();
        expect(undo).toHaveBeenCalledTimes(1);
        expect(redo).toHaveBeenCalledTimes(1);
    });

    it('should generate sequential group ids with labels', () => {
        const g1 = generateGroupId('Batch A');
        const g2 = generateGroupId('Batch B');
        expect(g1.groupId).toMatch(/^group-[a-f0-9]{8}$/i);
        expect(g2.groupId).toMatch(/^group-[a-f0-9]{8}$/i);
        expect(g1.groupId).not.toBe(g2.groupId);
        expect(g1.groupLabel).toBe('Batch A');
        expect(g2.groupLabel).toBe('Batch B');
    });

    it('should narrow action entries with isActionEntry', () => {
        const actionEntry = createUndoEntry('a', { type: 'toggleLoop' }, null);
        const cbEntry = createCallbackUndoEntry(
            'b',
            () => {},
            () => {}
        );
        expect(isActionEntry(actionEntry)).toBe(true);
        expect(isActionEntry(cbEntry)).toBe(false);
    });
});
