import { clampFaderGain } from '#/utils/audioLevelLaw';

import { type Device } from '../../models/TrackViewTypes';
import { buildDeviceChain } from '../buildDeviceChain';

import { type OfflineTrackStrip } from './types';

type CreateOfflineTrackStripTrackInput = {
    gain: number;
    muted: boolean;
    pan: number;
    devices: Device[];
};

type CreateOfflineTrackStripOptions = {
    /**
     * Stem exports pass false: stems of muted tracks must carry the track's
     * content for "later use in a DAW" (exportStems documents this intent).
     * The mixdown path keeps the default — baking mute into the strip there
     * would leak muted-track audio otherwise (PR #616 review).
     */
    honorMuted?: boolean;
};

export async function createOfflineTrackStrip(
    offlineCtx: OfflineAudioContext,
    track: CreateOfflineTrackStripTrackInput,
    options: CreateOfflineTrackStripOptions = {}
): Promise<OfflineTrackStrip> {
    const honorMuted = options.honorMuted ?? true;
    const inputNode = offlineCtx.createGain();
    inputNode.gain.value = 1;

    const preFaderTap = offlineCtx.createGain();
    preFaderTap.gain.value = 1;

    const faderNode = offlineCtx.createGain();
    // FX-7: the live fader clamps to [0, 1] (`TrackNode.setGain`). This path
    // clamped only the floor, so a stored gain above unity — which importers and
    // older projects can carry — rendered louder on export than it ever played
    // back. The two runtimes must apply the same level law.
    faderNode.gain.value = clampFaderGain(track.gain);

    const postFaderGain = offlineCtx.createGain();
    // Mixdown bakes mute into the strip; stem exports opt out so muted
    // tracks still export their content (M-037).
    postFaderGain.gain.value = honorMuted && track.muted ? 0 : 1;

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
