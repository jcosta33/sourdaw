import { type Heads } from '@automerge/automerge';

export type ParsedProjectRevision = {
    documentIdentityEpoch: number;
    documents: Array<{ docId: string; heads: Heads }>;
    mutationEpoch: number;
};

export function parseProjectRevision(value: string): ParsedProjectRevision | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
        typeof record.documentIdentityEpoch !== 'number' ||
        typeof record.mutationEpoch !== 'number' ||
        !Array.isArray(record.documents)
    ) {
        return null;
    }
    const documents: ParsedProjectRevision['documents'] = [];
    for (const candidate of record.documents) {
        if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
            return null;
        }
        const document = candidate as Record<string, unknown>;
        if (
            typeof document.docId !== 'string' ||
            !Array.isArray(document.heads) ||
            document.heads.some((head) => typeof head !== 'string')
        ) {
            return null;
        }
        documents.push({ docId: document.docId, heads: document.heads as Heads });
    }
    return {
        documentIdentityEpoch: record.documentIdentityEpoch,
        documents,
        mutationEpoch: record.mutationEpoch,
    };
}
