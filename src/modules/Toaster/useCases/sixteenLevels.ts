export type SixteenLevelsTarget = 'velocity' | 'tune' | 'decay' | 'filter';

export type SixteenLevelsSession = {
    deviceId: string;
    padIndex: number;
    target: SixteenLevelsTarget;
};

// Keyed by deviceId so two Toaster instances can each enter 16-Levels on their
// own pad without sharing or stealing the other's session. The map's absence
// of a deviceId means "inactive" for that instance, so the active check and the
// field reads can never disagree.
export const activeSessions = new Map<string, SixteenLevelsSession>();
