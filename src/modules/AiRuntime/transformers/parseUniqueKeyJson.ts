/** Decode untrusted JSON without silently accepting duplicate object members. */
export function parseUniqueKeyJson(content = ''): unknown {
    try {
        if (hasDuplicateObjectKeys(content)) {
            return undefined;
        }
        return JSON.parse(content);
    } catch {
        return undefined;
    }
}

function hasDuplicateObjectKeys(content: string): boolean {
    const keyScopes: Array<Set<string> | null> = [];
    let previousToken = '';
    for (let index = 0; index < content.length; index += 1) {
        const token = content[index];
        if (token === '"') {
            let end = index + 1;
            while (end < content.length && content[end] !== '"') {
                end += content[end] === '\\' ? 2 : 1;
            }
            const keys = keyScopes.at(-1);
            if (keys && (previousToken === '{' || previousToken === ',')) {
                const key = JSON.parse(content.slice(index, end + 1)) as unknown;
                if (typeof key !== 'string' || keys.has(key)) {
                    return true;
                }
                keys.add(key);
            }
            index = end;
            previousToken = '"';
        } else if (token === '{' || token === '[') {
            keyScopes.push(token === '{' ? new Set() : null);
        } else if (token === '}' || token === ']') {
            keyScopes.pop();
        }
        if (token !== undefined && token.trim().length > 0) {
            previousToken = token;
        }
    }
    return false;
}
