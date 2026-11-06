import { US_PHYSICAL_KEY_CHARACTERS } from '../models/UsPhysicalKeyLayout';

/** The parts of a keydown that decide which key a shortcut combo names. */
type ShortcutKeyPress = {
    key: string;
    code: string;
    shiftKey: boolean;
    altKey: boolean;
};

function isLetter(key: string): boolean {
    return key.length === 1 && key.toLowerCase() !== key.toUpperCase();
}

/**
 * The key a shortcut combo names for this keydown. `KeyboardEvent.key` is the
 * character produced with the modifiers applied, so Option+D reports `∂` on
 * macOS and Shift+1 reports `!` on a US layout; no combo names those. When Alt
 * is held, or Shift on a non-letter, the key is read from the physical `code`
 * instead: through the user's layout map when it is loaded, else the US table.
 * Every other press keeps `key`, so unmodified letters follow the user's layout.
 */
export function resolveShortcutKey(press: ShortcutKeyPress, layoutMap: ReadonlyMap<string, string> | null): string {
    const modifierAltersCharacter = press.altKey || (press.shiftKey && !isLetter(press.key));
    if (!modifierAltersCharacter) {
        return press.key;
    }
    return layoutMap?.get(press.code) ?? US_PHYSICAL_KEY_CHARACTERS.get(press.code) ?? press.key;
}
