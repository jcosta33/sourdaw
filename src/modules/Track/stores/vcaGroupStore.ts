/**
 * In-memory VCA group store.
 */

export type VcaGroup = {
    id: string;
    name: string;
    gain: number;
    muted: boolean;
    trackIds: string[];
};

let vcaGroups: VcaGroup[] = [];

export function getVcaGroupsState(): VcaGroup[] {
    return vcaGroups;
}

export function setVcaGroupsState(groups: VcaGroup[]): void {
    vcaGroups = groups;
}
