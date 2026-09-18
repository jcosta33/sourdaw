import { addClip, addTrack, importMidiFile, removeTrack } from '#/modules/Arrangement/useCases';
import { cacheAudioBuffer, decodeAudioFileBuffer } from '#/modules/AudioEngine/useCases';
import { captureProjectTransitionAuthority, newProject } from '#/modules/Project/useCases';
import { DEFAULT_TEMPO_BPM, transportStore } from '#/modules/Transport/stores';
import { isAudioFile } from '#/utils/audioFileExtensions';

const MIDI_FILE_EXTENSIONS = ['mid', 'midi'];
const MINIMUM_AUDIO_CLIP_BEATS = 4;

type ImportDroppedLaunchFilesInput = {
    files: readonly File[];
};

type ImportDroppedLaunchFilesOutput =
    | { status: 'unsupported' }
    | { status: 'activation-failed' }
    | { status: 'superseded' }
    | { status: 'completed'; failedFileNames: string[] };

type SupportedDroppedFile = {
    file: File;
    kind: 'audio' | 'midi';
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

function getSupportedDroppedFiles(files: readonly File[]): SupportedDroppedFile[] {
    const supportedFiles: SupportedDroppedFile[] = [];
    for (const file of files) {
        const extension = getFileExtension(file);
        if (isMidiFile(file, extension)) {
            supportedFiles.push({ file, kind: 'midi' });
        } else if (file.type.startsWith('audio/') || isAudioFile(file.name)) {
            supportedFiles.push({ file, kind: 'audio' });
        }
    }
    return supportedFiles;
}

export async function importDroppedLaunchFiles({
    files,
}: ImportDroppedLaunchFilesInput): Promise<ImportDroppedLaunchFilesOutput> {
    const supportedFiles = getSupportedDroppedFiles(files);
    if (supportedFiles.length === 0) {
        return { status: 'unsupported' };
    }

    const failedFileNames: string[] = [];
    if (!(await newProject())) {
        return { status: 'activation-failed' };
    }
    const authority = captureProjectTransitionAuthority();

    for (const { file, kind } of supportedFiles) {
        if (!authority.isCurrent()) {
            return { status: 'superseded' };
        }
        if (kind === 'midi') {
            const outcome = await importMidiFile(file, { shouldContinue: authority.isCurrent });
            if (outcome === 'superseded' || !authority.isCurrent()) {
                return { status: 'superseded' };
            }
            continue;
        }

        const name = getFileNameWithoutExtension(file);
        let createdTrackId: string | null = null;
        try {
            const buffer = await decodeAudioFileBuffer(file);
            if (!authority.isCurrent()) {
                return { status: 'superseded' };
            }

            const bufferId = `audio-${crypto.randomUUID()}`;
            const track = addTrack({ name, kind: 'audio' });
            if (!track) {
                continue;
            }
            createdTrackId = track.id;
            if (!authority.isCurrent()) {
                removeTrack(track.id);
                return { status: 'superseded' };
            }

            const tempo = transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM;
            const beats = Math.max(MINIMUM_AUDIO_CLIP_BEATS, Math.ceil((buffer.duration / 60) * tempo));
            const clip = addClip({
                trackId: track.id,
                startBeat: 0,
                endBeat: beats,
                name,
                type: 'audio',
                audioBufferId: bufferId,
            });
            if (!clip) {
                removeTrack(track.id);
                createdTrackId = null;
                continue;
            }
            if (!authority.isCurrent()) {
                removeTrack(track.id);
                return { status: 'superseded' };
            }

            cacheAudioBuffer({ buffer, bufferId });
            createdTrackId = null;
        } catch {
            if (createdTrackId) {
                removeTrack(createdTrackId);
            }
            failedFileNames.push(file.name);
        }
    }

    return { status: 'completed', failedFileNames };
}
