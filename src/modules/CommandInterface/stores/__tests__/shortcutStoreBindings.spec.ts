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

// Shortcut-conflict guard over the hand-authored default shortcut definitions.
// The maintainers already police this by hand — a dead duplicate `Escape`
// binding was deliberately removed (see shortcutStore comment) because
// `handleKeydown` returns on the first matching definition, making any later
// duplicate combo unreachable. This test locks that invariant in.
//
// The generated Loop-Station pad grid (`loopStation.*`) is excluded: those pads
// deliberately reuse single-letter keys (e.g. `m`, `r`, `g`) but are resolved
// through a separate, mode-gated path (`parseLoopStationPadCallbackId`), not the
// first-match `matches()` scan the core shortcuts share.
describe('INITIAL_DEFINITIONS shortcut conflicts', () => {
    it('has no two core (non-loop-station) definitions bound to the same key combo', () => {
        const definitions = shortcutStore.value?.definitions ?? [];
        const core = definitions.filter((def) => !def.id.startsWith('loopStation.'));
        expect(core.length).toBeGreaterThan(0);

        const owners = new Map<string, string>();
        const conflicts: Array<{ combo: string; first: string; second: string }> = [];
        for (const def of core) {
            for (const combo of def.defaultKeys) {
                const normalized = combo.toLowerCase();
                const existing = owners.get(normalized);
                if (existing !== undefined) {
                    conflicts.push({ combo: normalized, first: existing, second: def.id });
                } else {
                    owners.set(normalized, def.id);
                }
            }
        }

        expect(conflicts).toEqual([]);
    });
});
