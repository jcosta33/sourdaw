function pairUp(produced: string, base: string): ReadonlyMap<string, string> {
    const producedCharacters = [...produced];
    const baseCharacters = [...base];
    if (producedCharacters.length !== baseCharacters.length) {
        throw new Error('Modified-character table rows must pair one produced character with one base key');
    }
    return new Map(
        producedCharacters.flatMap((character, index): [string, string][] => {
            const baseCharacter = baseCharacters[index];
            // Keyed by the canonical lowercase form combos are parsed to: Option+Z's `Ω` parses as `ω`.
            return baseCharacter === undefined ? [] : [[character.toLowerCase(), baseCharacter]];
        })
    );
}

/** The character Shift produces on each US non-letter key, mapped back to the key's unmodified character. */
export const US_SHIFTED_SYMBOL_BASE_KEYS: ReadonlyMap<string, string> = pairUp(
    '!@#$%^&*()_+{}|:"<>?~',
    "1234567890-=[]\\;',./`"
);

/**
 * The character Option produces on each key of the US macOS layout, mapped back
 * to the key's unmodified character. Option+E, I, N, U and ` are dead keys and
 * report `Dead`, which names no key, so they have no entry.
 */
export const US_MAC_OPTION_LAYER_BASE_KEYS: ReadonlyMap<string, string> = pairUp(
    'å∫ç∂ƒ©˙∆˚¬µøπœ®ß†√∑≈¥Ω¡™£¢∞§¶•ªº–≠“‘«…æ≤≥÷',
    "abcdfghjklmopqrstvwxyz1234567890-=[]\\;',./"
);
