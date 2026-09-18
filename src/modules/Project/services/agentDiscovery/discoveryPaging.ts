import { MAX_SEMANTIC_QUERY_PAGE_SIZE } from '../../models/SemanticProjectQuery';

/**
 * Paging for discovery receipts, under the semantic query layer's own rules.
 *
 * The bound and the refusals are the semantic layer's so that a caller paging a
 * project query and a caller paging a discovery receipt meet the same limits and
 * read the same failure text. A cursor is bound to the fingerprint of the
 * revision and query it was minted under: it cannot be replayed against a moved
 * catalog or a different filter set.
 */
const DEFAULT_DISCOVERY_PAGE_SIZE = 20;
const CURSOR_VERSION = 'v1';

export type DiscoveryPageBounds = {
    offset: number;
    limit: number;
};

export function mintDiscoveryCursor(fingerprint: string, offset: number): string {
    return `${CURSOR_VERSION}:${fingerprint}:${String(offset)}`;
}

export function readDiscoveryPage(args: {
    limit: number | undefined;
    cursor: string | undefined;
    fingerprint: string;
}): DiscoveryPageBounds {
    const limit = args.limit ?? DEFAULT_DISCOVERY_PAGE_SIZE;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEMANTIC_QUERY_PAGE_SIZE) {
        throw new Error(`Semantic query page limit must be between 1 and ${String(MAX_SEMANTIC_QUERY_PAGE_SIZE)}`);
    }
    if (args.cursor === undefined) {
        return { offset: 0, limit };
    }
    const [version, fingerprint, offsetText, extra] = args.cursor.split(':');
    const offset = Number(offsetText);
    if (
        version !== CURSOR_VERSION ||
        fingerprint !== args.fingerprint ||
        extra !== undefined ||
        !Number.isInteger(offset) ||
        offset < 0
    ) {
        throw new Error('Invalid or stale semantic query cursor');
    }
    return { offset, limit };
}
