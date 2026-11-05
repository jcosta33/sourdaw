import { parseShortcutCombo } from '../models/ShortcutCombo';

const KEY_LABELS: Record<string, string> = {
    ' ': 'Space',
    Enter: '⏎',
    Backspace: '⌫',
    Delete: 'Del',
    Escape: 'Esc',
};

/**
 * Renders a shortcut-store combo (`mod+shift+a`) as space-separated keycap text
 * (`⌘ ⇧ A`), modifiers in macOS menu order. Every view that shows a binding uses
 * this, so the same combo never reads two ways.
 */
export function formatShortcutCombo(combo: string): string {
    const parsed = parseShortcutCombo(combo);
    if (!parsed) {
        return combo;
    }
    const symbols: string[] = [];
    if (parsed.mod) {
        symbols.push('⌘');
    }
    if (parsed.alt) {
        symbols.push('⌥');
    }
    if (parsed.shift) {
        symbols.push('⇧');
    }
    const key = KEY_LABELS[parsed.key] ?? (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);
    return [...symbols, key].join(' ');
}
