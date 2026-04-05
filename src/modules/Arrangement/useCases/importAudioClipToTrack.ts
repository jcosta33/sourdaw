import { getTrackById } from '../repositories/track/getTrackById';
import { addClip } from './clip/addClip';
import { decodeAudioFile } from '#/modules/AudioEngine/useCases/decodeAudioFile';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { notifyUser } from '#/helpers/Notification/notifyUser';

/**
 * Decode an audio file and append it as a new clip at the end of an existing track.
 * Use `importAudioFile` instead if a brand-new track should be created.
 */
export async function importAudioClipToTrack(trackId: string, file: File): Promise<void> {
    let bufferId: string;
    let buffer: AudioBuffer;

    try {
        const result = await decodeAudioFile(file);
        bufferId = result.id;
        buffer = result.buffer;
    } catch {
        notifyUser(`Failed to import "${file.name}" — unsupported format or corrupt file`, 'error');
        return;
    }

    const track = getTrackById(trackId);
    if (!track) {
        return;
    }

    const transport = getTransportState();
    const tempo = transport?.tempo ?? 120;
    const durationBeats = Math.ceil((buffer.duration / 60) * tempo);
    const lastClipEnd = Math.max(0, ...track.clips.map((c) => c.endBeat));
    const name = file.name.replace(/\.[^.]+$/, '');

    addClip({
        trackId,
        startBeat: lastClipEnd,
        endBeat: lastClipEnd + durationBeats,
        name,
        type: 'audio',
        audioBufferId: bufferId,
    });
}
