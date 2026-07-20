import type {
    DormantVcaTrackCandidate,
    MigrateLegacyVcaGroupsInput,
    VcaGroupMigrationResult,
} from '../../../models/VcaTrackMigration';

const DEFAULT_VCA_COLORS = ['#7C3AED', '#2563EB', '#0891B2', '#059669', '#CA8A04', '#DC2626'] as const;

type LegacyVcaGroup = {
    id: string;
    name: string;
    gain: number;
    muted: boolean;
    soloed: boolean;
    color: string;
    trackIds: string[];
};

type LegacyVcaGroupInput = Omit<LegacyVcaGroup, 'soloed' | 'color'> & {
    soloed?: boolean;
    color?: string;
};

type InvalidMigration = Extract<VcaGroupMigrationResult, { status: 'invalid' }>;
type MigrationError = InvalidMigration['errors'][number];
type MigrationCollection = Extract<VcaGroupMigrationResult, { status: 'ready' }>['collections'][number];

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
    const memberOwners = new Map<string, string>();

    for (let groupIndex = 0; groupIndex < legacyGroups.length; groupIndex += 1) {
        const parsedGroup = parseLegacyGroup(legacyGroups[groupIndex], groupIndex);
        if ('status' in parsedGroup) {
            return parsedGroup;
        }
        if (groupIds.has(parsedGroup.id)) {
            return invalid({ code: 'duplicate-group-id', groupIndex, field: 'id', value: parsedGroup.id });
        }

        for (const trackId of parsedGroup.trackIds) {
            const owner = memberOwners.get(trackId);
            if (owner !== undefined && owner !== parsedGroup.id) {
                return invalid({ code: 'ambiguous-membership', groupIndex, field: 'trackIds', value: trackId });
            }
            memberOwners.set(trackId, parsedGroup.id);
        }

        groupIds.add(parsedGroup.id);
        parsedGroups.push(parsedGroup);
    }

    return parsedGroups;
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

    let sourceGroups = parsedGroups;
    if (sourceGroups.length === 0) {
        sourceGroups = existingCandidates.map((candidate) => ({
            ...candidate,
            id: candidate.legacyGroupId,
            trackIds: [...candidate.memberTrackIds],
        }));
    }

    const occupiedIds = new Set(trackCollections.flatMap((collection) => collection.trackIds));

    const existingCandidateByGroupId = new Map<string, DormantVcaTrackCandidate>();
    for (const candidate of existingCandidates) {
        occupiedIds.add(candidate.id);
        existingCandidateByGroupId.set(candidate.legacyGroupId, candidate);
    }

    const candidates: DormantVcaTrackCandidate[] = [];
    const candidateIdByGroupId = new Map<string, string>();
    for (const [order, group] of sourceGroups.entries()) {
        const existingCandidate = existingCandidateByGroupId.get(group.id);
        let candidateId: string;
        if (existingCandidate !== undefined) {
            candidateId = existingCandidate.id;
        } else {
            candidateId = allocateCandidateId(group.id, occupiedIds);
        }

        candidateIdByGroupId.set(group.id, candidateId);
        candidates.push({
            id: candidateId,
            legacyGroupId: group.id,
            kind: 'vca',
            order,
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
                if (presentTrackIds.has(trackId)) {
                    assignments.push({ trackId, vcaTrackId: candidateId });
                    continue;
                }
                missingMembers.push({ legacyGroupId: group.id, trackId });
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
