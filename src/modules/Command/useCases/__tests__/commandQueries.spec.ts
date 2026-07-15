import { describe, it, expect, vi } from 'vitest';

import { type AppAction } from '../../models/AppAction';
import { createUndoEntry } from '../createUndoEntry';

describe('commandQueries (undo helpers)', () => {
    it('should build an action undo entry with sequential ids and the given source', () => {
        const action: AppAction = { type: 'removeAllTracks' };
        const inverse: AppAction = { type: 'togglePlayback' };
        vi.spyOn(Date, 'now').mockReturnValue(9_000_001);

        const alpha = createUndoEntry('Test', action, inverse, 'voice');
        const b = createUndoEntry('Test 2', action, null, 'manual');

        expect(alpha.id).toMatch(/^undo-[a-f0-9]{8}$/i);
        expect(b.id).toMatch(/^undo-[a-f0-9]{8}$/i);
        expect(alpha.id).not.toBe(b.id);
        expect(alpha).toMatchObject({
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
});
