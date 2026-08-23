import { parseDocument } from 'yaml';

/** Parse strict JSON after YAML enforces unique object keys. */
export function parseJsonWithUniqueKeys<T>(source: string, label: string): T {
    const document = parseDocument(source, { uniqueKeys: true });
    const yamlError = document.errors[0];
    if (yamlError !== undefined) {
        const message = yamlError.message;
        if (/Map keys must be unique/u.test(message)) {
            throw new Error(`${label}: duplicate key: ${message}`);
        }
        throw new Error(`${label}: invalid JSON: ${message}`);
    }
    try {
        return JSON.parse(source) as T;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${label}: invalid JSON: ${message}`);
    }
}
