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
    // Never bake mute into the strip: stems of muted tracks must carry the
    // track's content for "later use in a DAW" (exportStems documents this
    // intent), and the mixdown path already excludes muted tracks from clip
    // scheduling — zeroing here only produced silent stems (M-037).
    postFaderGain.gain.value = 1;

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
