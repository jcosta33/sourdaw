import { US_MAC_OPTION_LAYER_BASE_KEYS, US_SHIFTED_SYMBOL_BASE_KEYS } from './UsModifiedCharacterLayout';

/**
 * A shortcut-store combo string (`mod+shift+a`, `Space`, `mod++`) split into the
 * key it names and its modifiers. The key is canonical: `Space` is the literal
 * space a keydown reports, and single characters are lowercase, so two combos or
 * a combo and a keypress compare by plain equality.
 */
export type ShortcutCombo = {
    key: string;
    mod: boolean;
    shift: boolean;
    alt: boolean;
};

/** The canonical form of a key name, shared by combo parsing and keypress matching. */
export function canonicalShortcutKey(key: string): string {
    if (key === 'Space') {
        return ' ';
    }
    return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * Parses a combo string, or returns null when it names no key. A trailing `+` is
 * the key, not a separator: `split('+')` alone turns `mod++` into an empty key.
 */
export function parseShortcutCombo(combo: string): ShortcutCombo | null {
    const keyIsPlus = combo === '+' || combo.endsWith('++');
    const parts = keyIsPlus ? combo.slice(0, -1).split('+') : combo.split('+');
    const key = keyIsPlus ? '+' : parts.pop();
    if (!key) {
        return null;
    }
    return {
        key: canonicalShortcutKey(key),
        mod: parts.includes('mod'),
        shift: parts.includes('shift'),
        alt: parts.includes('alt'),
    };
}

/** Whether two combo strings name the same key with the same modifiers. */
export function shortcutCombosEqual(first: string, second: string): boolean {
    const left = parseShortcutCombo(first);
    const right = parseShortcutCombo(second);
    if (!left || !right) {
        return false;
    }
    return left.key === right.key && left.mod === right.mod && left.shift === right.shift && left.alt === right.alt;
}

/**
 * The base key a stored combo's character came from, when the combo's own
 * modifiers produced that character. Captures before physical-key resolution
 * stored the produced character (`alt+∂`, `shift+!`), which no keypress
 * resolves to any more. Read through the US tables, so a non-US layout's
 * characters stay unrecognised. `+` stays the key it names (`mod+shift++`,
 * `+`), because the zoom defaults bind it literally.
 */
function legacyBaseKey(combo: ShortcutCombo): string | null {
    if (combo.key === '+') {
        return null;
    }
    if (combo.alt) {
        const optionBase = US_MAC_OPTION_LAYER_BASE_KEYS.get(combo.key);
        if (optionBase) {
            return optionBase;
        }
    }
    return combo.shift ? (US_SHIFTED_SYMBOL_BASE_KEYS.get(combo.key) ?? null) : null;
}

/**
 * Rewrites a stored combo that names a modifier-produced character to the
 * physical key it was pressed on (`alt+∂` to `alt+d`, `shift+!` to `shift+1`).
 * Every other combo, including unknown characters such as `alt+Dead`, is
 * returned unchanged.
 */
export function migrateStoredShortcutCombo(stored: string): string {
    const combo = parseShortcutCombo(stored);
    const baseKey = combo ? legacyBaseKey(combo) : null;
    if (!combo || !baseKey) {
        return stored;
    }
    const modifiers = [combo.mod ? 'mod' : null, combo.shift ? 'shift' : null, combo.alt ? 'alt' : null];
    return [...modifiers.filter((modifier) => modifier !== null), baseKey].join('+');
}
