import { type Device } from '../../models/TrackViewTypes';
import { buildDeviceChain } from '../buildDeviceChain';

import { type OfflineTrackStrip } from './types';

type CreateOfflineTrackStripTrackInput = {
    gain: number;
    muted: boolean;
    pan: number;
    devices: Device[];
};

export async function createOfflineTrackStrip(
    offlineCtx: OfflineAudioContext,
    track: CreateOfflineTrackStripTrackInput
): Promise<OfflineTrackStrip> {
    const inputNode = offlineCtx.createGain();
    inputNode.gain.value = 1;

    const preFaderTap = offlineCtx.createGain();
    preFaderTap.gain.value = 1;

    const faderNode = offlineCtx.createGain();
    faderNode.gain.value = Math.max(0, track.gain);

    const postFaderGain = offlineCtx.createGain();
    postFaderGain.gain.value = track.muted ? 0 : 1;

    const panNode = offlineCtx.createStereoPanner();
    panNode.pan.value = Math.max(-1, Math.min(1, track.pan / 50));

    const outputNode = offlineCtx.createGain();
    outputNode.gain.value = 1;

    const deviceEntries = await buildDeviceChain(offlineCtx, track.devices, inputNode, preFaderTap);

    preFaderTap.connect(faderNode);
    faderNode.connect(postFaderGain);
    postFaderGain.connect(panNode);
    panNode.connect(outputNode);

    return {
        inputNode,
        preFaderTap,
        faderNode,
        postFaderGain,
        panNode,
        outputNode,
        deviceEntries,
    };
}
