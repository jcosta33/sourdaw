export type SidechainRoute = {
    id: string;
    sourceTrackId: string;
    targetTrackId: string;
    targetDeviceId: string;
    targetParameterId: string;
    gain: number;
};

let nextSidechainId = 1;

export const createSidechainRoute = (
    sourceTrackId: string,
    targetTrackId: string,
    targetDeviceId: string,
    targetParameterId = 'threshold',
    gain = 1
): SidechainRoute => ({
    id: `sidechain-${nextSidechainId++}`,
    sourceTrackId,
    targetTrackId,
    targetDeviceId,
    targetParameterId,
    gain,
});
