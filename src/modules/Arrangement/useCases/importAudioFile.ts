import { getTrackState, setTrackState } from '../repositories/track';
import { createTrack } from '../models/Track';
import { addClip } from '#/modules/Arrangement/useCases/clip/addClip';
import { decodeAudioFile } from '#/modules/AudioEngine/useCases/decodeAudioFile';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { notifyUser } from '#/helpers/Notification/notifyUser';

export async function importAudioFile(file: File): Promise<void> {
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

    const state = getTrackState();
    if (!state) {
        return;
    }

    const transport = getTransportState();
    const tempo = transport?.tempo ?? 120;
    const durationBeats = (buffer.duration / 60) * tempo;
    const endBeat = Math.ceil(durationBeats / 4) * 4;
    const name = file.name.replace(/\.[^.]+$/, '');

    const track = createTrack({ name, kind: 'audio' });

    addClip({
        trackId: track.id,
        startBeat: 0,
        endBeat: Math.max(4, endBeat),
        name,
        type: 'audio',
        audioBufferId: bufferId,
    });

    const ts = getTrackState();
    if (ts) {
        setTrackState({
            ...ts,
            tracks: [...ts.tracks, track],
        });
    }
}
