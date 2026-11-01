const MODIFIER_SYMBOLS: [modifier: string, symbol: string][] = [
    ['mod', '⌘'],
    ['alt', '⌥'],
    ['shift', '⇧'],
];

/**
 * Renders a shortcut-store combo (`mod+shift+a`) as the space-separated keycap
 * text the cheat sheet uses (`⌘ ⇧ A`). A trailing `+` is the key, not a separator.
 */
export const formatShortcutCombo = (combo: string): string => {
    const keyIsPlus = combo === '+' || combo.endsWith('++');
    const keyPart = keyIsPlus ? '+' : (combo.split('+').pop() ?? '');
    const modifiers = keyIsPlus ? combo.slice(0, -1).split('+') : combo.split('+').slice(0, -1);
    const symbols = MODIFIER_SYMBOLS.filter(([modifier]) => modifiers.includes(modifier)).map(([, symbol]) => symbol);
    const key = keyPart.length === 1 ? keyPart.toUpperCase() : keyPart;
    return [...symbols, key].join(' ');
};
