import { type CommandObjectReference } from '../models/VersionedCommandEnvelope';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getLeafName(path: string): string {
    const withoutIndexes = path.replaceAll(/\[\d+\]/g, '');
    return withoutIndexes.split('.').at(-1) ?? withoutIndexes;
}

function appendIdReferences(references: CommandObjectReference[], value: unknown, path: string): void {
    if (Array.isArray(value)) {
        for (const [index, item] of value.entries()) {
            appendIdReferences(references, item, `${path}[${String(index)}]`);
        }
        return;
    }
    if (isRecord(value)) {
        for (const [key, item] of Object.entries(value)) {
            appendIdReferences(references, item, path === '' ? key : `${path}.${key}`);
        }
        return;
    }
    const leaf = getLeafName(path);
    if (typeof value === 'string' && value !== '' && (leaf === 'id' || leaf.endsWith('Id') || leaf.endsWith('Ids'))) {
        references.push({
            argument: path,
            id: value,
            scope: value.startsWith('$') ? 'batch-local' : 'stable',
        });
    }
}

/**
 * Every non-empty string the arguments hold under an id-shaped key (`id`, `…Id`, `…Ids`), in
 * argument order. Envelopes recorded exactly this list as their object references before parameter
 * ids stopped counting as objects, so the parser still accepts it from an envelope persisted then.
 */
export function collectCommandIdReferences(
    argumentsValue: Readonly<Record<string, unknown>>
): CommandObjectReference[] {
    const references: CommandObjectReference[] = [];
    appendIdReferences(references, argumentsValue, '');
    return references;
}
