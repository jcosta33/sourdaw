/**
 * Routing's local `SidechainRoute` model.
 *
 * Owned by the Routing module — does not cross module boundaries.
 * Other modules that need to talk about sidechains define their own local
 * shape and translate at the boundary (see `AGENTS.md` model isolation).
 */

export type SidechainRoute = {
    id: string;
    sourceTrackId: string;
    targetTrackId: string;
    targetDeviceId: string;
    targetParameterId: string;
    gain: number;
};

export function sidechainRoutesMatch(left: SidechainRoute, right: SidechainRoute): boolean {
    return (
        left.id === right.id &&
        left.sourceTrackId === right.sourceTrackId &&
        left.targetTrackId === right.targetTrackId &&
        left.targetDeviceId === right.targetDeviceId &&
        left.targetParameterId === right.targetParameterId &&
        left.gain === right.gain
    );
}

export function createSidechainRoute(
    sourceTrackId: string,
    targetTrackId: string,
    targetDeviceId: string,
    targetParameterId = 'threshold',
    gain = 1
): SidechainRoute {
    return {
        id: `sidechain-${crypto.randomUUID()}`,
        sourceTrackId,
        targetTrackId,
        targetDeviceId,
        targetParameterId,
        gain,
    };
}
