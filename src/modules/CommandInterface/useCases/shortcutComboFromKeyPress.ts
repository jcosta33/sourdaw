import { resolveShortcutKey } from './resolveShortcutKey';

type ShortcutCapturePress = {
    key: string;
    code: string;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
};

/** The store's name for a key: `Space` for the space bar, lowercase for a character. */
function comboKeyName(key: string): string {
    if (key === ' ') {
        return 'Space';
    }
    return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * The combo string a captured keydown binds, in the shortcut store's form
 * (`mod+shift+alt+key`). The key comes from `resolveShortcutKey`, the same
 * resolution the global shortcut listener matches against, so a captured
 * combo fires on the press that captured it.
 */
export function shortcutComboFromKeyPress(
    press: ShortcutCapturePress,
    layoutMap: ReadonlyMap<string, string> | null
): string {
    const modifiers: string[] = [];
    if (press.metaKey || press.ctrlKey) {
        modifiers.push('mod');
    }
    if (press.shiftKey) {
        modifiers.push('shift');
    }
    if (press.altKey) {
        modifiers.push('alt');
    }
    return [...modifiers, comboKeyName(resolveShortcutKey(press, layoutMap))].join('+');
}
