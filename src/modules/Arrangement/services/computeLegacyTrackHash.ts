import { type Clip, type Device } from '../models/Track';

export async function computeLegacyTrackHash(clips: readonly Clip[], devices: readonly Device[]): Promise<string> {
    const sorted_clips = [...clips].sort(
        (left, right) => left.startBeat - right.startBeat || left.id.localeCompare(right.id)
    );
    const clip_strings = sorted_clips.map((clip) => {
        const duration = clip.endBeat - clip.startBeat;
        return `${clip.id}:${clip.startBeat}:${duration}:${clip.assetHash ?? ''}:${clip.gain}`;
    });
    const device_strings = devices.map((device) => {
        const sorted_parameters = Object.entries(device.parameterValues)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, value]) => `${key}=${value}`)
            .join(',');
        return `${device.id}:${device.type}:${sorted_parameters}:${device.bypassed}`;
    });
    const data = new TextEncoder().encode(`${clip_strings.join('|')}||${device_strings.join('|')}`);
    const hash_buffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash_buffer))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
}
