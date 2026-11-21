export function stringLiterals(contents: string): string[] {
    const values: string[] = [];
    for (let index = 0; index < contents.length; index += 1) {
        const character = contents[index]!;
        const next = contents[index + 1];
        if (character === '/' && next === '/') {
            index = contents.indexOf('\n', index + 2);
            if (index === -1) {
                break;
            }
            continue;
        }
        if (character === '/' && next === '*') {
            const end = contents.indexOf('*/', index + 2);
            if (end === -1) {
                break;
            }
            index = end + 1;
            continue;
        }
        if (character === '#') {
            index = contents.indexOf('\n', index + 1);
            if (index === -1) {
                break;
            }
            continue;
        }
        if (character !== "'" && character !== '"' && character !== '`') {
            continue;
        }

        let value = '';
        for (index += 1; index < contents.length; index += 1) {
            const stringCharacter = contents[index]!;
            if (stringCharacter === '\\' && index + 1 < contents.length) {
                value += stringCharacter + contents[index + 1]!;
                index += 1;
            } else if (stringCharacter === character) {
                values.push(value);
                break;
            } else {
                value += stringCharacter;
            }
        }
    }
    return values;
}

// Rust char literals: one code point or one escape between single quotes; any other quote is a lifetime or label.
const rustCharLiteral = /'(?:[^\\'\n\r\t]|\\(?:[nrt0\\'"]|x[0-9a-fA-F]{2}|u\{[0-9a-fA-F_]{1,6}\}))'/uy;
const rustIdentifierCharacter = /[\p{XID_Continue}]/u;

function isRustIdentifierCharacter(character: string | undefined): boolean {
    return character !== undefined && rustIdentifierCharacter.test(character);
}

function startsRustRawString(contents: string, index: number): boolean {
    if (contents[index] !== 'r') {
        return false;
    }
    const previous = contents[index - 1];
    const prefixed = (previous === 'b' || previous === 'c') && !isRustIdentifierCharacter(contents[index - 2]);
    if (isRustIdentifierCharacter(previous) && !prefixed) {
        return false;
    }
    let cursor = index + 1;
    while (contents[cursor] === '#') {
        cursor += 1;
    }
    return contents[cursor] === '"';
}

function skipRustBlockComment(contents: string, start: number): number {
    let depth = 0;
    for (let index = start; index < contents.length; index += 1) {
        if (contents[index] === '/' && contents[index + 1] === '*') {
            depth += 1;
            index += 1;
        } else if (contents[index] === '*' && contents[index + 1] === '/') {
            depth -= 1;
            index += 1;
            if (depth === 0) {
                return index;
            }
        }
    }
    return contents.length;
}

export function rustStringLiterals(contents: string): string[] {
    const values: string[] = [];
    for (let index = 0; index < contents.length; index += 1) {
        const character = contents[index]!;
        const next = contents[index + 1];
        if (character === '/' && next === '/') {
            index = contents.indexOf('\n', index + 2);
            if (index === -1) {
                break;
            }
            continue;
        }
        if (character === '/' && next === '*') {
            index = skipRustBlockComment(contents, index);
            continue;
        }
        if (character === "'") {
            rustCharLiteral.lastIndex = index;
            const literal = rustCharLiteral.exec(contents);
            if (literal !== null) {
                index += literal[0].length - 1;
            }
            continue;
        }
        if (startsRustRawString(contents, index)) {
            const quote = contents.indexOf('"', index);
            const terminator = `"${'#'.repeat(quote - index - 1)}`;
            const end = contents.indexOf(terminator, quote + 1);
            if (end === -1) {
                break;
            }
            values.push(contents.slice(quote + 1, end));
            index = end + terminator.length - 1;
            continue;
        }
        if (character !== '"') {
            continue;
        }

        let value = '';
        for (index += 1; index < contents.length; index += 1) {
            const stringCharacter = contents[index]!;
            if (stringCharacter === '\\' && index + 1 < contents.length) {
                value += stringCharacter + contents[index + 1]!;
                index += 1;
            } else if (stringCharacter === '"') {
                values.push(value);
                break;
            } else {
                value += stringCharacter;
            }
        }
    }
    return values;
}
