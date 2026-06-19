import { describe, it, expect } from 'vitest';

import { editCommands } from '../editCommands';

/**
 * Regression coverage for audit #18/#52: the "Deselect All" palette entry
 * advertised `⌘⇧D`, but that combo is bound to `arrangement.duplicateTrack`
 * in the shortcut store — pressing it duplicated a track instead of clearing
 * the selection. The displayed shortcut was a lie, so it was removed.
 */
describe('editCommands — Deselect All shortcut', () => {
    const deselectAll = editCommands.find((cmd) => cmd.id === 'deselect-all');

    it('exposes the Deselect All command', () => {
        expect(deselectAll).toBeDefined();
        expect(deselectAll?.label).toBe('Deselect All');
    });

    it('does not advertise a (false) ⌘⇧D shortcut', () => {
        // `⌘⇧D` triggers Duplicate Track, not deselect — so no keycap is shown.
        expect(deselectAll?.shortcut).toBeUndefined();
    });

    it('keeps the deselect action wired', () => {
        expect(typeof deselectAll?.action).toBe('function');
    });
});
