import { type Clip, type Device } from '../models/Track';

function stable_serialize(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stable_serialize).join(',')}]`;
    }
    const entries = Object.entries(value)
        .filter(([, nested_value]) => nested_value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, nested_value]) => `${JSON.stringify(key)}:${stable_serialize(nested_value)}`).join(',')}}`;
}

/**
 * Computes a SHA-256 hash of canonical clip/device state plus the effective
 * adjustment-layer signature used by freeze rendering.
 *
 * Conforms to R3: Content Hash Computation.
 */
export async function computeTrackHash(
    clips: readonly Clip[],
    devices: readonly Device[],
    adjustmentLayerSignature = ''
): Promise<string> {
    const sortedClips = [...clips].sort(
        (alpha, buffer) => alpha.startBeat - buffer.startBeat || alpha.id.localeCompare(buffer.id)
    );
    const contentString = stable_serialize({
        clips: sortedClips.map((clip) => ({
            id: clip.id,
            trackId: clip.trackId,
            startBeat: clip.startBeat,
            endBeat: clip.endBeat,
            type: clip.type,
            audioBufferId: clip.audioBufferId,
            assetHash: clip.assetHash,
            audioOffsetBeats: clip.audioOffsetBeats,
            midiOffsetBeats: clip.midiOffsetBeats,
            fadeInBeats: clip.fadeInBeats,
            fadeOutBeats: clip.fadeOutBeats,
            gain: clip.gain,
            muted: clip.muted,
            stretchMode: clip.stretchMode,
            stretchRatio: clip.stretchRatio,
            loopEnabled: clip.loopEnabled,
            loopLength: clip.loopLength,
            sourceKeyRoot: clip.sourceKeyRoot,
            sourceScaleName: clip.sourceScaleName,
            parentClipId: clip.parentClipId,
            isLinkedInstance: clip.isLinkedInstance,
            overrides: clip.overrides,
            kneadState: clip.kneadState,
        })),
        devices: devices.map((device) => ({
            id: device.id,
            type: device.type,
            bypassed: device.bypassed,
            parameterValues: device.parameterValues,
            externalPluginId: device.externalPluginId,
            externalInstanceId: device.externalInstanceId,
        })),
        adjustmentLayerSignature,
    });

    const encoder = new TextEncoder();
    const data = encoder.encode(contentString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((buffer) => buffer.toString(16).padStart(2, '0')).join('');
}
