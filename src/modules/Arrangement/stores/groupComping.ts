/**
 * Group comping store — multi-track comp groups.
 * Extracted from groupCompingUseCases.ts.
 *
 * F6 — previously a bare `createStore({ initialData })` with no storage
 * adapter, so all comp-group/take organization vanished on reload. Backed by
 * the same `createStore` + `createAutomergeStorage` pattern #982 used for
 * gain envelopes and VCA groups: this is durable project data (which takes a
 * musician kept, which pass is active), not session-only scratch state.
 */
import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { type Store } from '#/infra/store/types';

const DOC_PREFIX_ROOT = 'root';

export type CompGroupEntry = {
    id: string;
    name: string;
    trackIds: string[];
    takeSets: CompTakeSet[];
    activeTakeSetId: string | null;
    compRegions: GroupCompRegion[];
    createdAt: string;
};

export type CompTakeSet = {
    id: string;
    name: string;
    pass: number;
    color: string;
    recordedAt: string;
};

export type GroupCompRegion = {
    id: string;
    startBeat: number;
    endBeat: number;
    takeSetId: string;
    crossfadeBeats: number;
};

export type GroupCompingState = {
    groups: CompGroupEntry[];
    activeGroupId: string | null;
    defaultCrossfade: number;
};

export const defaultGroupCompingState: GroupCompingState = {
    groups: [],
    activeGroupId: null,
    defaultCrossfade: 0.125,
};

function isCompTakeSet(value: unknown): value is CompTakeSet {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!('id' in value) || typeof value.id !== 'string' || value.id.length === 0) {
        return false;
    }
    if (!('name' in value) || typeof value.name !== 'string') {
        return false;
    }
    if (!('pass' in value) || typeof value.pass !== 'number' || !Number.isFinite(value.pass)) {
        return false;
    }
    if (!('color' in value) || typeof value.color !== 'string') {
        return false;
    }
    return 'recordedAt' in value && typeof value.recordedAt === 'string';
}

function isGroupCompRegion(value: unknown): value is GroupCompRegion {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!('id' in value) || typeof value.id !== 'string' || value.id.length === 0) {
        return false;
    }
    if (!('startBeat' in value) || typeof value.startBeat !== 'number' || !Number.isFinite(value.startBeat)) {
        return false;
    }
    if (!('endBeat' in value) || typeof value.endBeat !== 'number' || !Number.isFinite(value.endBeat)) {
        return false;
    }
    if (!('takeSetId' in value) || typeof value.takeSetId !== 'string' || value.takeSetId.length === 0) {
        return false;
    }
    return (
        'crossfadeBeats' in value && typeof value.crossfadeBeats === 'number' && Number.isFinite(value.crossfadeBeats)
    );
}

function isCompGroupEntry(value: unknown): value is CompGroupEntry {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!('id' in value) || typeof value.id !== 'string' || value.id.length === 0) {
        return false;
    }
    if (!('name' in value) || typeof value.name !== 'string') {
        return false;
    }
    if (
        !('trackIds' in value) ||
        !Array.isArray(value.trackIds) ||
        !value.trackIds.every((id) => typeof id === 'string')
    ) {
        return false;
    }
    if (!('takeSets' in value) || !Array.isArray(value.takeSets) || !value.takeSets.every(isCompTakeSet)) {
        return false;
    }
    if (
        !('activeTakeSetId' in value) ||
        (typeof value.activeTakeSetId !== 'string' && value.activeTakeSetId !== null)
    ) {
        return false;
    }
    if (!('compRegions' in value) || !Array.isArray(value.compRegions) || !value.compRegions.every(isGroupCompRegion)) {
        return false;
    }
    return 'createdAt' in value && typeof value.createdAt === 'string';
}

const COMP_TAKE_SET_KEYS = ['id', 'name', 'pass', 'color', 'recordedAt'] as const;
const GROUP_COMP_REGION_KEYS = ['id', 'startBeat', 'endBeat', 'takeSetId', 'crossfadeBeats'] as const;
const COMP_GROUP_ENTRY_KEYS = [
    'id',
    'name',
    'trackIds',
    'takeSets',
    'activeTakeSetId',
    'compRegions',
    'createdAt',
] as const;

/**
 * Decode persisted comp groups from a project file or from the
 * `groupComping` document slot — one decoder, so the two load paths cannot
 * drift. A group that does not decode is dropped rather than repaired.
 * Duplicated ids keep the first occurrence.
 */
export function sanitizeCompGroups(value: unknown): CompGroupEntry[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const groups: CompGroupEntry[] = [];
    const seenIds = new Set<string>();
    for (const candidate of value) {
        if (!isCompGroupEntry(candidate) || seenIds.has(candidate.id)) {
            continue;
        }
        seenIds.add(candidate.id);
        groups.push({
            id: candidate.id,
            name: candidate.name,
            trackIds: [...candidate.trackIds],
            takeSets: candidate.takeSets.map((takeSet) => ({ ...takeSet })),
            activeTakeSetId: candidate.activeTakeSetId,
            compRegions: candidate.compRegions.map((region) => ({ ...region })),
            createdAt: candidate.createdAt,
        });
    }
    return groups;
}

function isExactGroupCompingState(value: unknown): value is GroupCompingState {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const keys = Object.keys(value);
    if (keys.length !== 3 || !('groups' in value) || !('activeGroupId' in value) || !('defaultCrossfade' in value)) {
        return false;
    }
    if (!Array.isArray(value.groups)) {
        return false;
    }
    if (typeof value.activeGroupId !== 'string' && value.activeGroupId !== null) {
        return false;
    }
    if (typeof value.defaultCrossfade !== 'number' || !Number.isFinite(value.defaultCrossfade)) {
        return false;
    }

    const seenIds = new Set<string>();
    for (const candidate of value.groups) {
        if (!isCompGroupEntry(candidate) || seenIds.has(candidate.id)) {
            return false;
        }
        if (Object.keys(candidate).length !== COMP_GROUP_ENTRY_KEYS.length) {
            return false;
        }
        if (candidate.takeSets.some((takeSet) => Object.keys(takeSet).length !== COMP_TAKE_SET_KEYS.length)) {
            return false;
        }
        if (candidate.compRegions.some((region) => Object.keys(region).length !== GROUP_COMP_REGION_KEYS.length)) {
            return false;
        }
        seenIds.add(candidate.id);
    }
    return true;
}

/**
 * Store-shaped decoder for the `groupComping` document slot.
 *
 * Returns the argument itself when it already decodes exactly, so `createStore`
 * sees an identical value and does not write a sanitized copy back over a
 * shared document.
 */
function sanitizeGroupCompingState(value: unknown): GroupCompingState {
    if (isExactGroupCompingState(value)) {
        return value;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return defaultGroupCompingState;
    }
    const groups = 'groups' in value ? sanitizeCompGroups(value.groups) : [];
    const activeGroupId =
        'activeGroupId' in value && (typeof value.activeGroupId === 'string' || value.activeGroupId === null)
            ? value.activeGroupId
            : null;
    const defaultCrossfade =
        'defaultCrossfade' in value &&
        typeof value.defaultCrossfade === 'number' &&
        Number.isFinite(value.defaultCrossfade)
            ? value.defaultCrossfade
            : 0.125;
    return { groups, activeGroupId, defaultCrossfade };
}

export const groupCompingStore: Store<GroupCompingState> = createStore<GroupCompingState>({
    storage: createAutomergeStorage<GroupCompingState>(DOC_PREFIX_ROOT, 'groupComping', {
        // A document without the `groupComping` slot resets the store to
        // empty rather than back-writing this replica's cache (audit CC-2).
        hydrateMissing: () => defaultGroupCompingState,
    }),
    initialData: defaultGroupCompingState,
    sanitize: sanitizeGroupCompingState,
});

// §122.1 — UUID instead of module-level counters that reset on HMR
// and collide across sequential creates after a reload.
export function getNextGroupId(): string {
    return `grp-${crypto.randomUUID()}`;
}
export function getNextTakeSetId(): string {
    return `ts-${crypto.randomUUID()}`;
}
export function getNextRegionId(): string {
    return `gr-${crypto.randomUUID()}`;
}

export const GROUP_COLORS = [
    'oklch(0.42 0.10 150)',
    'oklch(0.42 0.10 210)',
    'oklch(0.42 0.10 290)',
    'oklch(0.42 0.10 340)',
    'oklch(0.42 0.10 50)',
    'oklch(0.42 0.10 80)',
];
