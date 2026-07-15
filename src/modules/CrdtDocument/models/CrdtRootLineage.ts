export const DEFAULT_CRDT_ROOT_LINEAGE = 'main';
export const MAX_CRDT_ROOT_LINEAGE_LENGTH = 128;

const CRDT_ROOT_LINEAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Validate a branch/root identity without normalizing distinct tokens together. */
export function parseCrdtRootLineage(value: unknown): string | null {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > MAX_CRDT_ROOT_LINEAGE_LENGTH ||
        !CRDT_ROOT_LINEAGE_PATTERN.test(value)
    ) {
        return null;
    }

    return value;
}
