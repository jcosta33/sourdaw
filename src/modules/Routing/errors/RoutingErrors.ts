export class SidechainCycleError extends Error {
    readonly sourceTrackId: string;
    readonly targetTrackId: string;

    constructor(sourceTrackId: string, targetTrackId: string) {
        super(`Sidechain route ${sourceTrackId} → ${targetTrackId} would create a routing cycle`);
        this.name = 'SidechainCycleError';
        this.sourceTrackId = sourceTrackId;
        this.targetTrackId = targetTrackId;
    }
}
