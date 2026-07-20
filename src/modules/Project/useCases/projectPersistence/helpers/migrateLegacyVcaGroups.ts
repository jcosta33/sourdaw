import type {
    DormantVcaTrackCandidate,
    MigrateLegacyVcaGroupsInput,
    VcaGroupMigrationResult,
} from '../../../models/VcaTrackMigration';

const DEFAULT_VCA_COLORS = ['#7C3AED', '#2563EB', '#0891B2', '#059669', '#CA8A04', '#DC2626'] as const;

type LegacyVcaGroup = {
    id: string;
    order: number;
    name: string;
    gain: number;
    muted: boolean;
    soloed: boolean;
    color: string;
    trackIds: string[];
};

type LegacyVcaGroupInput = Omit<LegacyVcaGroup, 'order' | 'soloed' | 'color'> & {
    soloed?: boolean;
    color?: string;
};

type InvalidMigration = Extract<VcaGroupMigrationResult, { status: 'invalid' }>;
type MigrationError = InvalidMigration['errors'][number];
type MigrationCollection = Extract<VcaGroupMigrationResult, { status: 'ready' }>['collections'][number];
type MigrationTrackCollection = MigrateLegacyVcaGroupsInput['trackCollections'][number];

function invalid(error: MigrationError): InvalidMigration {
    return { status: 'invalid', errors: [error] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLegacyVcaGroupInput(value: Record<string, unknown>): value is Record<string, unknown> & LegacyVcaGroupInput {
    if (typeof value.id !== 'string' || value.id.length === 0) {
        return false;
    }
    if (typeof value.name !== 'string' || typeof value.gain !== 'number' || typeof value.muted !== 'boolean') {
        return false;
    }
    if (value.soloed !== undefined && typeof value.soloed !== 'boolean') {
        return false;
    }
    if (value.color !== undefined && typeof value.color !== 'string') {
        return false;
    }
    if (!Array.isArray(value.trackIds)) {
        return false;
    }
    return value.trackIds.every((trackId) => typeof trackId === 'string');
}

function getDefaultColor(groupId: string): string {
    let hash = 0;
    for (const character of groupId) {
        hash += character.charCodeAt(0);
    }
    const colorIndex = hash % DEFAULT_VCA_COLORS.length;
    return DEFAULT_VCA_COLORS[colorIndex] ?? '#7C3AED';
}

function parseLegacyGroup(value: unknown, groupIndex: number): LegacyVcaGroup | InvalidMigration {
    if (!isRecord(value)) {
        return invalid({ code: 'invalid-group', groupIndex, field: 'group' });
    }
    if (typeof value.gain !== 'number' || !Number.isFinite(value.gain)) {
        return invalid({ code: 'invalid-gain', groupIndex, field: 'gain' });
    }
    if (!isLegacyVcaGroupInput(value)) {
        return invalid({ code: 'invalid-group', groupIndex, field: 'group' });
    }

    return {
        id: value.id,
        order: groupIndex,
        name: value.name,
        gain: value.gain,
        muted: value.muted,
        soloed: value.soloed ?? false,
        color: value.color ?? getDefaultColor(value.id),
        trackIds: [...new Set(value.trackIds)],
    };
}

function parseLegacyGroups(legacyGroups: unknown): LegacyVcaGroup[] | InvalidMigration {
    if (legacyGroups === undefined) {
        return [];
    }
    if (!Array.isArray(legacyGroups)) {
        return invalid({ code: 'invalid-legacy-groups', groupIndex: 0, field: 'legacyGroups' });
    }

    const parsedGroups: LegacyVcaGroup[] = [];
    const groupIds = new Set<string>();

    for (let groupIndex = 0; groupIndex < legacyGroups.length; groupIndex += 1) {
        const parsedGroup = parseLegacyGroup(legacyGroups[groupIndex], groupIndex);
        if ('status' in parsedGroup) {
            return parsedGroup;
        }
        if (groupIds.has(parsedGroup.id)) {
            return invalid({ code: 'duplicate-group-id', groupIndex, field: 'id', value: parsedGroup.id });
        }

        groupIds.add(parsedGroup.id);
        parsedGroups.push(parsedGroup);
    }

    return parsedGroups;
}

function mergeSourceGroups({
    parsedGroups,
    existingCandidates,
}: {
    parsedGroups: LegacyVcaGroup[];
    existingCandidates: readonly DormantVcaTrackCandidate[];
}): LegacyVcaGroup[] | InvalidMigration {
    const parsedGroupById = new Map(parsedGroups.map((group) => [group.id, group]));
    const remainingParsedGroupIds = new Set(parsedGroupById.keys());
    const existingGroupIds = new Set<string>();
    const existingOrders = new Set<number>();
    const sourceGroups: LegacyVcaGroup[] = [];

    for (let candidateIndex = 0; candidateIndex < existingCandidates.length; candidateIndex += 1) {
        const candidate = existingCandidates[candidateIndex];
        if (candidate === undefined) {
            continue;
        }
        if (existingGroupIds.has(candidate.legacyGroupId)) {
            return invalid({
                code: 'duplicate-group-id',
                groupIndex: candidateIndex,
                field: 'existingCandidates',
                value: candidate.legacyGroupId,
            });
        }
        if (!Number.isSafeInteger(candidate.order) || candidate.order < 0) {
            return invalid({
                code: 'invalid-candidate-order',
                groupIndex: candidateIndex,
                field: 'order',
                value: String(candidate.order),
            });
        }
        if (existingOrders.has(candidate.order)) {
            return invalid({
                code: 'duplicate-candidate-order',
                groupIndex: candidateIndex,
                field: 'order',
                value: String(candidate.order),
            });
        }

        const parsedGroup = parsedGroupById.get(candidate.legacyGroupId);
        if (parsedGroup !== undefined) {
            sourceGroups.push({ ...parsedGroup, order: candidate.order, trackIds: [...parsedGroup.trackIds] });
            remainingParsedGroupIds.delete(candidate.legacyGroupId);
        } else {
            sourceGroups.push({
                id: candidate.legacyGroupId,
                order: candidate.order,
                name: candidate.name,
                gain: candidate.gain,
                muted: candidate.muted,
                soloed: candidate.soloed,
                color: candidate.color,
                trackIds: [...candidate.memberTrackIds],
            });
        }
        existingGroupIds.add(candidate.legacyGroupId);
        existingOrders.add(candidate.order);
    }

    let nextLegacyOrder = 0;
    for (const parsedGroup of parsedGroups) {
        if (!remainingParsedGroupIds.has(parsedGroup.id)) {
            continue;
        }
        while (existingOrders.has(nextLegacyOrder)) {
            nextLegacyOrder += 1;
        }
        sourceGroups.push({ ...parsedGroup, order: nextLegacyOrder, trackIds: [...parsedGroup.trackIds] });
        existingOrders.add(nextLegacyOrder);
        nextLegacyOrder += 1;
    }

    sourceGroups.sort((left, right) => left.order - right.order);
    return sourceGroups;
}

function reconcileTrackMemberships({
    sourceGroups,
    trackCollections,
}: {
    sourceGroups: LegacyVcaGroup[];
    trackCollections: readonly MigrationTrackCollection[];
}): LegacyVcaGroup[] | InvalidMigration {
    const groupIndexById = new Map<string, number>();
    const ownerByTrackId = new Map<string, string>();

    for (const [groupIndex, group] of sourceGroups.entries()) {
        groupIndexById.set(group.id, groupIndex);
        for (const trackId of group.trackIds) {
            const existingOwner = ownerByTrackId.get(trackId);
            if (existingOwner !== undefined && existingOwner !== group.id) {
                return invalid({ code: 'ambiguous-membership', groupIndex, field: 'trackIds', value: trackId });
            }
            ownerByTrackId.set(trackId, group.id);
        }
    }

    for (const collection of trackCollections) {
        const trackReferences = collection.legacyVcaGroupIdByTrackId;
        if (trackReferences === undefined) {
            continue;
        }

        for (const trackId of collection.trackIds) {
            const referencedGroupId = trackReferences[trackId];
            if (referencedGroupId === undefined || referencedGroupId === null) {
                continue;
            }

            const referencedGroupIndex = groupIndexById.get(referencedGroupId);
            if (referencedGroupIndex === undefined) {
                return invalid({
                    code: 'unknown-membership-group',
                    collectionId: collection.collectionId,
                    field: 'legacyVcaGroupIdByTrackId',
                    value: trackId,
                    reference: referencedGroupId,
                });
            }

            const existingOwner = ownerByTrackId.get(trackId);
            if (existingOwner !== undefined && existingOwner !== referencedGroupId) {
                return invalid({
                    code: 'ambiguous-membership',
                    groupIndex: referencedGroupIndex,
                    collectionId: collection.collectionId,
                    field: 'legacyVcaGroupIdByTrackId',
                    value: trackId,
                });
            }
            if (existingOwner !== undefined) {
                continue;
            }

            const referencedGroup = sourceGroups[referencedGroupIndex];
            if (referencedGroup === undefined) {
                return invalid({
                    code: 'unknown-membership-group',
                    collectionId: collection.collectionId,
                    field: 'legacyVcaGroupIdByTrackId',
                    value: trackId,
                    reference: referencedGroupId,
                });
            }
            referencedGroup.trackIds.push(trackId);
            ownerByTrackId.set(trackId, referencedGroupId);
        }
    }

    return sourceGroups;
}

function isExplicitlyUnassigned(collection: MigrationTrackCollection, trackId: string): boolean {
    const trackReferences = collection.legacyVcaGroupIdByTrackId;
    if (trackReferences === undefined || !Object.hasOwn(trackReferences, trackId)) {
        return false;
    }
    return trackReferences[trackId] === null;
}

function allocateCandidateId(groupId: string, occupiedIds: Set<string>): string {
    if (!occupiedIds.has(groupId)) {
        occupiedIds.add(groupId);
        return groupId;
    }

    let candidateId = `${groupId}-vca`;
    let suffix = 1;
    while (occupiedIds.has(candidateId)) {
        suffix += 1;
        candidateId = `${groupId}-vca-${suffix}`;
    }

    occupiedIds.add(candidateId);
    return candidateId;
}

export function migrateLegacyVcaGroups({
    legacyGroups,
    trackCollections,
    existingCandidates = [],
}: MigrateLegacyVcaGroupsInput): VcaGroupMigrationResult {
    const parsedGroups = parseLegacyGroups(legacyGroups);
    if ('status' in parsedGroups) {
        return parsedGroups;
    }

    const mergedSourceGroups = mergeSourceGroups({ parsedGroups, existingCandidates });
    if ('status' in mergedSourceGroups) {
        return mergedSourceGroups;
    }
    const sourceGroups = reconcileTrackMemberships({
        sourceGroups: mergedSourceGroups,
        trackCollections,
    });
    if ('status' in sourceGroups) {
        return sourceGroups;
    }

    const occupiedIds = new Set(trackCollections.flatMap((collection) => collection.trackIds));

    const existingCandidateByGroupId = new Map<string, DormantVcaTrackCandidate>();
    for (const candidate of existingCandidates) {
        existingCandidateByGroupId.set(candidate.legacyGroupId, candidate);
    }

    const candidateIdByGroupId = new Map<string, string>();
    for (const group of sourceGroups) {
        const existingCandidate = existingCandidateByGroupId.get(group.id);
        if (existingCandidate === undefined || existingCandidate.id.length === 0) {
            continue;
        }
        if (occupiedIds.has(existingCandidate.id)) {
            continue;
        }

        occupiedIds.add(existingCandidate.id);
        candidateIdByGroupId.set(group.id, existingCandidate.id);
    }

    for (const group of sourceGroups) {
        const existingCandidate = existingCandidateByGroupId.get(group.id);
        if (existingCandidate === undefined || candidateIdByGroupId.has(group.id)) {
            continue;
        }

        candidateIdByGroupId.set(group.id, allocateCandidateId(group.id, occupiedIds));
    }

    for (const group of sourceGroups) {
        if (candidateIdByGroupId.has(group.id)) {
            continue;
        }

        candidateIdByGroupId.set(group.id, allocateCandidateId(group.id, occupiedIds));
    }

    const candidates: DormantVcaTrackCandidate[] = [];
    for (const group of sourceGroups) {
        const candidateId = candidateIdByGroupId.get(group.id);
        if (candidateId === undefined) {
            continue;
        }

        candidates.push({
            id: candidateId,
            legacyGroupId: group.id,
            kind: 'vca',
            order: group.order,
            name: group.name,
            color: group.color,
            gain: group.gain,
            muted: group.muted,
            soloed: group.soloed,
            memberTrackIds: [...group.trackIds],
            clips: [],
            devices: [],
            sends: [],
            midiFx: [],
            inputId: null,
            outputId: null,
            meterEnabled: false,
        });
    }

    const collections: MigrationCollection[] = trackCollections.map((collection) => {
        const presentTrackIds = new Set(collection.trackIds);
        const assignments: MigrationCollection['assignments'] = [];
        const missingMembers: MigrationCollection['missingMembers'] = [];

        for (const group of sourceGroups) {
            const candidateId = candidateIdByGroupId.get(group.id);
            if (candidateId === undefined) {
                continue;
            }
            for (const trackId of group.trackIds) {
                if (!presentTrackIds.has(trackId)) {
                    missingMembers.push({ legacyGroupId: group.id, trackId });
                    continue;
                }
                if (isExplicitlyUnassigned(collection, trackId)) {
                    continue;
                }
                assignments.push({ trackId, vcaTrackId: candidateId });
            }
        }

        return {
            collectionId: collection.collectionId,
            selectedTrackId: collection.selectedTrackId,
            trackIds: [...collection.trackIds],
            assignments,
            missingMembers,
        };
    });

    return {
        status: 'ready',
        candidates,
        collections,
    };
}
