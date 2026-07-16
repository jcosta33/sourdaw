import { addClip, addTrack, importMidiFile } from '#/modules/Arrangement/useCases';
import { decodeAudioFile } from '#/modules/AudioEngine/useCases';
import { newProject } from '#/modules/Project/useCases';
import { transportStore } from '#/modules/Transport/stores';

const AUDIO_FILE_EXTENSIONS = ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'webm', 'aiff', 'aif'];
const MIDI_FILE_EXTENSIONS = ['mid', 'midi'];
const DEFAULT_TEMPO = 120;
const MINIMUM_AUDIO_CLIP_BEATS = 4;

type ImportDroppedLaunchFilesInput = {
    files: readonly File[];
};

type ImportDroppedLaunchFilesOutput = {
    failedFileNames: string[];
};

function getFileExtension(file: File): string {
    return file.name.toLowerCase().split('.').pop() ?? '';
}

function getFileNameWithoutExtension(file: File): string {
    return file.name.replace(/\.[^.]+$/, '');
}

function isMidiFile(file: File, extension: string): boolean {
    return MIDI_FILE_EXTENSIONS.includes(extension) || file.type === 'audio/midi';
}

function isAudioFile(file: File, extension: string): boolean {
    return file.type.startsWith('audio/') || AUDIO_FILE_EXTENSIONS.includes(extension);
}

export async function importDroppedLaunchFiles({
    files,
}: ImportDroppedLaunchFilesInput): Promise<ImportDroppedLaunchFilesOutput> {
    const failedFileNames: string[] = [];
    newProject();

    for (const file of files) {
        const extension = getFileExtension(file);
        if (isMidiFile(file, extension)) {
            await importMidiFile(file);
            continue;
        }
        if (!isAudioFile(file, extension)) {
            continue;
        }

        const name = getFileNameWithoutExtension(file);
        const track = addTrack({ name, kind: 'audio' });
        if (!track) {
            continue;
        }

        try {
            const { id: bufferId, buffer } = await decodeAudioFile(file);
            const tempo = transportStore.value?.tempo ?? DEFAULT_TEMPO;
            const beats = Math.max(MINIMUM_AUDIO_CLIP_BEATS, Math.ceil((buffer.duration / 60) * tempo));
            addClip({
                trackId: track.id,
                startBeat: 0,
                endBeat: beats,
                name,
                type: 'audio',
                audioBufferId: bufferId,
            });
        } catch {
            failedFileNames.push(file.name);
        }
    }

    return { failedFileNames };
}
