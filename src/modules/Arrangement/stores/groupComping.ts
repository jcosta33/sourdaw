/**
 * Group comping store — multi-track comp groups.
 * Extracted from groupCompingUseCases.ts.
 */
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

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

export const groupCompingStore = new Store<GroupCompingState>(logger, {
    initialData: { groups: [], activeGroupId: null, defaultCrossfade: 0.125 },
});

let groupId = 1;
let takeSetId = 1;
let regionId = 1;

export function getNextGroupId(): string {
    return `grp-${groupId++}`;
}
export function getNextTakeSetId(): string {
    return `ts-${takeSetId++}`;
}
export function getNextRegionId(): string {
    return `gr-${regionId++}`;
}

export const GROUP_COLORS = [
    'oklch(0.42 0.10 150)',
    'oklch(0.42 0.10 210)',
    'oklch(0.42 0.10 290)',
    'oklch(0.42 0.10 340)',
    'oklch(0.42 0.10 50)',
    'oklch(0.42 0.10 80)',
];
