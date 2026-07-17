import type { Track } from '#/modules/Arrangement/stores';
import type { Device } from './builderTypes';

type AttachSidechainCompressorInput = {
    track: Track;
    name?: string;
    threshold?: number;
    ratio?: number;
    attack?: number;
    release?: number;
    knee?: number;
    makeup?: number;
};

export function attachSidechainCompressor(input: AttachSidechainCompressorInput): string {
    const deviceId = `dev-${crypto.randomUUID()}`;
    const device: Device = {
        id: deviceId,
        name: input.name ?? 'SC Comp',
        type: 'builtin-sidechain-compressor',
        bypassed: false,
        parameterValues: {
            'sc-comp-threshold': input.threshold ?? -24,
            'sc-comp-ratio': input.ratio ?? 4,
            'sc-comp-attack': input.attack ?? 5,
            'sc-comp-release': input.release ?? 180,
            'sc-comp-knee': input.knee ?? 6,
            'sc-comp-makeup': input.makeup ?? 2,
        },
    };
    input.track.devices = [...input.track.devices, device];
    return deviceId;
}
