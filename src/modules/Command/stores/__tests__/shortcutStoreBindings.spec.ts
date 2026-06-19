import { describe, it, expect } from 'vitest';

import { shortcutStore } from '../shortcutStore';

/**
 * Regression coverage for the keyboard-binding audit fixes:
 *   • #36/#38 — `view.zoomToSelection` must bind `shift+f` so the
 *     exact-modifier match in `handleKeydown`'s `matches()` can fire (the old
 *     bare `'F'` combo was unreachable: it required `shift === false`, but you
 *     can't type uppercase `F` without Shift, and plain `f` matched
 *     `view.zoomToFit` first).
 *   • clearClipSelection dead alias — `Escape` must be owned by exactly one
 *     definition (`transport.stopPlayback`); the duplicate
 *     `workspace.clearClipSelection` Escape alias was dead code because the
 *     handleKeydown loop returns on the first match.
 */
describe('shortcut store bindings', () => {
    function defs() {
        return shortcutStore.value?.definitions ?? [];
    }

    it('binds view.zoomToSelection to shift+f, not a bare uppercase F', () => {
        const zoomToSelection = defs().find((def) => def.id === 'view.zoomToSelection');
        expect(zoomToSelection?.defaultKeys).toEqual(['shift+f']);
        // The old, unreachable binding must not survive.
        expect(zoomToSelection?.defaultKeys).not.toContain('F');
    });

    it('keeps view.zoomToFit on plain f (no Shift) so the two never collide', () => {
        const zoomToFit = defs().find((def) => def.id === 'view.zoomToFit');
        expect(zoomToFit?.defaultKeys).toContain('f');
        // zoomToFit owns the no-modifier `f`; zoomToSelection owns Shift+F.
        expect(zoomToFit?.defaultKeys).not.toContain('shift+f');
    });

    it('binds Escape to exactly one definition (transport.stopPlayback)', () => {
        const escapeOwners = defs().filter((def) => def.defaultKeys.includes('Escape'));
        expect(escapeOwners.map((def) => def.id)).toEqual(['transport.stopPlayback']);
    });

    it('no longer carries a dead workspace.clearClipSelection definition', () => {
        expect(defs().some((def) => def.id === 'workspace.clearClipSelection')).toBe(false);
    });
});
