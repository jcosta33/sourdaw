/** Parse JSON while rejecting duplicate object keys before JSON.parse discards them. */
export function parseJsonWithUniqueKeys<T>(source: string, label: string): T {
    let index = 0;

    const fail = (message: string): never => {
        throw new Error(`${label}: ${message}`);
    };
    const whitespace = (): void => {
        while (/\s/u.test(source[index] ?? '')) {
            index += 1;
        }
    };
    const string = (): string => {
        const start = index;
        if (source[index] !== '"') {
            return fail(`expected string at byte ${String(index)}`);
        }
        index += 1;
        while (index < source.length) {
            const character = source[index]!;
            if (character === '\\') {
                index += 2;
                continue;
            }
            index += 1;
            if (character === '"') {
                try {
                    return JSON.parse(source.slice(start, index)) as string;
                } catch {
                    return fail(`invalid string at byte ${String(start)}`);
                }
            }
            if (character.charCodeAt(0) < 0x20) {
                return fail(`invalid control character at byte ${String(index - 1)}`);
            }
        }
        return fail(`unterminated string at byte ${String(start)}`);
    };
    const value = (path: string): void => {
        whitespace();
        const character = source[index];
        if (character === undefined) {
            fail(`expected value at byte ${String(index)}`);
        }
        if (character === '{') {
            index += 1;
            whitespace();
            const keys = new Set<string>();
            if (source[index] === '}') {
                index += 1;
                return;
            }
            while (true) {
                whitespace();
                const key = string();
                if (keys.has(key)) {
                    fail(`duplicate key ${path}.${key}`);
                }
                keys.add(key);
                whitespace();
                if (source[index] !== ':') {
                    fail(`expected ':' at byte ${String(index)}`);
                }
                index += 1;
                value(`${path}.${key}`);
                whitespace();
                if (source[index] === '}') {
                    index += 1;
                    return;
                }
                if (source[index] !== ',') {
                    fail(`expected ',' or '}' at byte ${String(index)}`);
                }
                index += 1;
            }
        }
        if (character === '[') {
            index += 1;
            whitespace();
            let item = 0;
            if (source[index] === ']') {
                index += 1;
                return;
            }
            while (true) {
                value(`${path}[${String(item)}]`);
                item += 1;
                whitespace();
                if (source[index] === ']') {
                    index += 1;
                    return;
                }
                if (source[index] !== ',') {
                    fail(`expected ',' or ']' at byte ${String(index)}`);
                }
                index += 1;
            }
        }
        if (character === '"') {
            string();
            return;
        }
        const start = index;
        while (!/[\s,}\]]/u.test(source[index] ?? '')) {
            index += 1;
        }
        const token = source.slice(start, index);
        try {
            JSON.parse(token);
        } catch {
            fail(`invalid value at byte ${String(start)}`);
        }
    };

    value('$');
    whitespace();
    if (index !== source.length) {
        fail(`unexpected content at byte ${String(index)}`);
    }
    try {
        return JSON.parse(source) as T;
    } catch {
        return fail('invalid JSON');
    }
}
