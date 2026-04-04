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

export class DuplicateSidechainRouteError extends Error {
    readonly sourceTrackId: string;
    readonly targetDeviceId: string;

    constructor(sourceTrackId: string, targetDeviceId: string) {
        super(`Sidechain route from ${sourceTrackId} to device ${targetDeviceId} already exists`);
        this.name = 'DuplicateSidechainRouteError';
        this.sourceTrackId = sourceTrackId;
        this.targetDeviceId = targetDeviceId;
    }
}
