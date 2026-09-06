import { decodeAudioFile, discardDecodedAudioFile } from '#/modules/AudioEngine/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getTrackById } from '../repositories/track/getTrackById';

import { addClip } from './clip/addClip';

type ImportAudioClipToTrackOptions = {
    shouldContinue: () => boolean;
};

type ImportAudioClipToTrackOutput = 'completed' | 'superseded';

export async function importAudioClipToTrack(
    trackId: string,
    file: File,
    { shouldContinue }: ImportAudioClipToTrackOptions
): Promise<ImportAudioClipToTrackOutput> {
    let bufferId: string;
    let buffer: AudioBuffer;

    try {
        const result = await decodeAudioFile(file);
        bufferId = result.id;
        buffer = result.buffer;
    } catch {
        if (!shouldContinue()) {
            return 'superseded';
        }
        notifyUser(`Failed to import "${file.name}" — unsupported format or corrupt file`, 'error');
        return 'completed';
    }

    if (!shouldContinue()) {
        discardDecodedAudioFile(bufferId);
        return 'superseded';
    }

    const track = getTrackById(trackId);
    if (!track) {
        discardDecodedAudioFile(bufferId);
        return 'completed';
    }

    const transport = transportStore.value;
    const tempo = transport?.tempo ?? 120;
    const durationBeats = Math.ceil((buffer.duration / 60) * tempo);
    const lastClipEnd = Math.max(0, ...track.clips.map((context) => context.endBeat));
    const name = file.name.replace(/\.[^.]+$/, '');

    try {
        const clip = addClip({
            trackId,
            startBeat: lastClipEnd,
            endBeat: lastClipEnd + durationBeats,
            name,
            type: 'audio',
            audioBufferId: bufferId,
        });
        if (clip) {
            return 'completed';
        }
    } catch {
        // The decoded buffer remains owned by this import until a clip accepts it.
    }

    discardDecodedAudioFile(bufferId);
    if (shouldContinue()) {
        notifyUser(`Failed to import "${file.name}" — project state could not be updated`, 'error');
    } else {
        return 'superseded';
    }

    return 'completed';
}
