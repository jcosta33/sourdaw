import { describe, expect, it } from 'vitest';

import { DEFAULT_SHORTCUTS, formatKeyBinding } from '../Shortcuts';

describe('DEFAULT_SHORTCUTS', () => {
    it('should define bindings for core actions (ShortcutMap is exhaustive at compile time)', () => {
        expect(DEFAULT_SHORTCUTS.PLAY_PAUSE).toEqual({ key: ' ' });
        expect(DEFAULT_SHORTCUTS.UNDO).toEqual({ key: 'z', metaKey: true });
        expect(DEFAULT_SHORTCUTS.TOGGLE_AI_ASSISTANT).toEqual({ key: 'k', metaKey: true });
    });
});

describe('formatKeyBinding', () => {
    it('should label space and modifier chords', () => {
        expect(formatKeyBinding({ key: ' ' })).toBe('Space');
        expect(formatKeyBinding({ key: 'z', metaKey: true })).toBe('⌘Z');
        expect(formatKeyBinding({ key: 'z', metaKey: true, shiftKey: true })).toBe('⌘⇧Z');
    });

    it('should use symbols for backspace and enter', () => {
        expect(formatKeyBinding({ key: 'Backspace' })).toBe('⌫');
        expect(formatKeyBinding({ key: 'Enter' })).toBe('⏎');
    });

    it('should join Ctrl with + when other join rules use plus', () => {
        expect(formatKeyBinding({ key: 'g', ctrlKey: true })).toBe('Ctrl+G');
    });
});
