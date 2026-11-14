/** Immutable read model for palette availability; never mutation authority. */
export type CommandContext = {
    readonly selectedClipId: string | null;
    readonly selectedClipIds: readonly string[];
    readonly selectedClipType: 'audio' | 'midi' | null;
    readonly hasAutomationLane: boolean;
};
