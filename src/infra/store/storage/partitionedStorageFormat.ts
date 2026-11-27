import { parse, stringify } from 'superjson';

/**
 * Who wrote a part's key. `commit` is the commit the index must name beside the part for a read to
 * accept it; `write` is unique to this write, so a key never holds the same text twice and a read
 * that finds a key's text unchanged knows the key did not change in between.
 */
export type PartHeader = { commit: string; write: string; writtenAt: number };

/** A part key's text: its header, and the part's superjson text, empty for an evicted part. */
export type StoredPartText = { header: PartHeader; body: string };

/** One part the index names, and the commit that must have written its key. */
export type IndexEntry = { id: string; commit: string };

export type StoredIndex<TIndex> = { index: TIndex; parts: IndexEntry[] };

/**
 * How long a commit can still be running after it wrote a part. A commit runs within one task, so a
 * part whose commit the index does not name, written longer ago than this, was left by a commit that
 * stopped before its index write, never by one still in flight.
 */
export const IN_FLIGHT_COMMIT_BOUND_MS = 60_000;

export function encodePartText(header: PartHeader, body: string): string {
    return `${JSON.stringify(header)}\n${body}`;
}

function readPartHeader(value: unknown): PartHeader | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    if (!('commit' in value) || !('write' in value) || !('writtenAt' in value)) {
        return null;
    }
    const { commit, write, writtenAt } = value;
    if (typeof commit !== 'string' || typeof write !== 'string' || typeof writtenAt !== 'number') {
        return null;
    }
    return { commit, write, writtenAt };
}

/** The header and body of a part key's text, or null when it was not written by this format. */
export function decodePartText(text: string): StoredPartText | null {
    // superjson text has no raw newline, so the first one ends the header.
    const newline = text.indexOf('\n');
    if (newline < 0) {
        return null;
    }
    let header: unknown;
    try {
        header = JSON.parse(text.slice(0, newline));
    } catch {
        return null;
    }
    const decoded = readPartHeader(header);
    return decoded === null ? null : { header: decoded, body: text.slice(newline + 1) };
}

function isIndexEntry(value: unknown): value is IndexEntry {
    return (
        typeof value === 'object' &&
        value !== null &&
        'id' in value &&
        'commit' in value &&
        typeof value.id === 'string' &&
        typeof value.commit === 'string'
    );
}

function readIndexEntries(stored: unknown): IndexEntry[] | null {
    if (typeof stored !== 'object' || stored === null || !('parts' in stored) || !Array.isArray(stored.parts)) {
        return null;
    }
    const parts: unknown[] = stored.parts;
    return parts.every(isIndexEntry) ? parts : null;
}

export function encodeIndexText(index: unknown, parts: IndexEntry[]): string {
    return stringify({ index, parts } satisfies StoredIndex<unknown>);
}

/** The stored index, or null when its text does not parse as one. */
export function decodeIndexText<TIndex>(text: string): StoredIndex<TIndex> | null {
    let stored: StoredIndex<TIndex>;
    try {
        stored = parse<StoredIndex<TIndex>>(text);
    } catch {
        return null;
    }
    return readIndexEntries(stored) === null ? null : stored;
}
