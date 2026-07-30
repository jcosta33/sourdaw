export function normalizeSafeProjectName(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const name = value.trim();
    if (name.length === 0 || name.length > 120) {
        return null;
    }

    for (const character of name) {
        const codePoint = character.codePointAt(0);
        if (
            character === '<' ||
            character === '>' ||
            character === '&' ||
            codePoint === undefined ||
            codePoint < 32 ||
            codePoint === 127
        ) {
            return null;
        }
    }

    return name;
}
