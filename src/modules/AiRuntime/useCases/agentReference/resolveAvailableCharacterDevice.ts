import { queryAgentDiscovery } from '#/modules/Project/useCases';

type CharacterDeviceResolution = { status: 'resolved'; deviceType: string } | { status: 'unresolved'; reason: string };

function declaresCharacter(evidence: Readonly<Record<string, unknown>>, character: string): boolean {
    const { characterTags } = evidence;
    return Array.isArray(characterTags) && characterTags.includes(character);
}

function findAvailableCharacterDevice(character: string, cursor?: string): CharacterDeviceResolution {
    const result = queryAgentDiscovery({ domain: 'device', filters: { text: character }, page: { cursor } });
    if (result.status !== 'receipt') {
        return { status: 'unresolved', reason: `device discovery is ${result.status} (${result.reason})` };
    }
    const match = result.receipt.items.find(
        (item) => item.availability === 'available' && declaresCharacter(item.evidence, character)
    );
    if (match) {
        return { status: 'resolved', deviceType: match.id };
    }
    const { nextCursor } = result.receipt;
    if (nextCursor === null) {
        return { status: 'unresolved', reason: `no available device declares the ${character} character` };
    }
    return findAvailableCharacterDevice(character, nextCursor);
}

/**
 * The device a workflow instantiates for a requested character, read from the
 * descriptors' own declarations through owner discovery.
 *
 * The text filter only narrows the search: it also matches display names, so the
 * descriptor's declared tags decide. A device the owner reports unavailable is
 * skipped rather than offered. Several matches resolve to the first in
 * discovery's canonical order, which is stable id ascending, so the same
 * catalogue always yields the same device.
 */
export function resolveAvailableCharacterDevice(character: string): CharacterDeviceResolution {
    return findAvailableCharacterDevice(character);
}
