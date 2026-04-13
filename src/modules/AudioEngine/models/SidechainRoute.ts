export type SidechainRoute = {
    id: string;
    sourceTrackId: string;
    targetTrackId: string;
    targetDeviceId: string;
    targetParameterId: string;
    gain: number;
};

export const createSidechainRoute = (
    sourceTrackId: string,
    targetTrackId: string,
    targetDeviceId: string,
    targetParameterId = 'threshold',
    gain = 1
): SidechainRoute => ({
    id: `sidechain-${crypto.randomUUID()}`,
    sourceTrackId,
    targetTrackId,
    targetDeviceId,
    targetParameterId,
    gain,
});
