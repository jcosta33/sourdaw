export type SidechainTargetCapability = {
    targetParameterId: 'threshold';
};

export function getSidechainTargetCapability(deviceType: string): SidechainTargetCapability | null {
    if (deviceType !== 'builtin-sidechain-compressor') {
        return null;
    }
    return { targetParameterId: 'threshold' };
}
