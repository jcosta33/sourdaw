export type VCAGroup = {
    id: string;
    name: string;
    gain: number; // 0-1, multiplied against target track gains
};

export // In-memory VCA group store
const vcaGroups = new Map<string, VCAGroup>();
