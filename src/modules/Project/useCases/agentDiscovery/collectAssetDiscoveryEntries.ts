import { type SemanticIndexEntity, type SemanticProjectIndexSnapshot } from '../../models/SemanticProjectQuery';
import { type DiscoveryCandidate } from '../../services/agentDiscovery/discoveryCandidates';

type AssetReference = {
    assetId: string;
    contentAddress: string | null;
    contentType: string | null;
    assetType: string | null;
    clipIds: string[];
};

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function addReference(references: Map<string, AssetReference>, clip: SemanticIndexEntity): void {
    const assetId = readString(clip.audioBufferId);
    if (assetId === null) {
        return;
    }
    const existing = references.get(assetId);
    if (existing) {
        existing.clipIds.push(clip.id);
        return;
    }
    references.set(assetId, {
        assetId,
        contentAddress: readString(clip.assetHash),
        contentType: clip.contentType ?? null,
        assetType: clip.assetType ?? null,
        clipIds: [clip.id],
    });
}

/**
 * The assets this project's clips reference, read from the semantic index.
 *
 * The library carries no name for an asset, so the entry is named by the id the
 * index holds rather than by a clip that happens to use it: a clip's name
 * belongs to the clip. Every asset here exists because a clip references it, so
 * the receipt cannot name one the project does not use.
 */
export function collectAssetDiscoveryEntries(snapshot: SemanticProjectIndexSnapshot): DiscoveryCandidate[] {
    const references = new Map<string, AssetReference>();
    for (const clip of snapshot.tracks) {
        if (clip.kind !== 'clip') {
            continue;
        }
        addReference(references, clip);
    }
    return Array.from(references.values(), (reference): DiscoveryCandidate => ({
        // The index publishes no kind vocabulary a caller may filter assets by.
        kind: null,
        entry: {
            id: reference.assetId,
            name: reference.assetId,
            domain: 'asset',
            availability: 'available',
            reason: null,
            version: snapshot.revisionToken,
            evidence: {
                source: 'semantic-project-index',
                contentType: reference.contentType,
                assetType: reference.assetType,
                contentAddress: reference.contentAddress,
                clipIds: reference.clipIds,
            },
        },
    }));
}
