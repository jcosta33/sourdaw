import { detectTempo } from '#/modules/AudioAnalysis/useCases';
import { decodeAudioFile, releasePreviewAudioBuffer } from '#/modules/AudioEngine/useCases';
import { pickFiles } from '#/modules/Project/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { type StemImportRole } from '#/utils/handlerContract';

import { discardPreparedStemImportResources } from './discardPreparedStemImportResources';

const MAX_SOURCE_BYTES_PER_STEM = 256 * 1024 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 1024 * 1024 * 1024;
const MAX_DECODED_BYTES_PER_STEM = 256 * 1024 * 1024;
const MAX_TOTAL_DECODED_BYTES = 1024 * 1024 * 1024;
const MAX_DURATION_SECONDS_PER_STEM = 60 * 60;
const MAX_TOTAL_DURATION_SECONDS = 4 * 60 * 60;

const STEM_ROLES = [
    'kick',
    'snare',
    'hi-hat',
    'tom',
    'percussion',
    'bass',
    'guitar-left',
    'guitar-right',
    'keys',
    'synth',
    'lead-vocal',
    'backing-vocal',
    'fx',
    'other',
] as const;

function normalize(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted === true) {
        throw new DOMException('Stem import preparation was cancelled.', 'AbortError');
    }
}

export async function prepareStemImport(
    signal?: AbortSignal,
    admitWork?: (input: { analysisCount: number; downloadBytes: number; storageBytes: number }) => boolean
) {
    const files = await pickFiles({
        multiple: true,
        filters: [{ name: 'Audio stems', extensions: ['wav', 'aif', 'aiff', 'flac', 'mp3', 'ogg', 'm4a'] }],
    });
    if (!files) {
        return { status: 'cancelled' as const };
    }
    if (files.length < 2 || files.length > 32) {
        throw new Error('Select between 2 and 32 audio stems.');
    }
    if (new Set(files.map((file) => normalize(file.name))).size !== files.length) {
        throw new Error('Selected stem filenames must be unique.');
    }
    const totalSourceBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (files.some((file) => file.size > MAX_SOURCE_BYTES_PER_STEM)) {
        throw new Error('Each selected stem must be 256 MiB or smaller.');
    }
    if (totalSourceBytes > MAX_TOTAL_SOURCE_BYTES) {
        throw new Error('The selected stem set must total 1 GiB or less.');
    }
    if (
        !admitWork?.({ analysisCount: files.length, downloadBytes: totalSourceBytes, storageBytes: totalSourceBytes })
    ) {
        throw new Error('The selected stem preparation exceeds the user budget.');
    }

    const projectTempo = transportStore.value?.tempo ?? 120;
    if (!Number.isFinite(projectTempo) || projectTempo < 20 || projectTempo > 999) {
        throw new Error('The current project tempo is unavailable for stem alignment.');
    }

    const prepared: Array<{
        stemId: string;
        sourceName: string;
        sourceTempo: number;
        durationSeconds: number;
        sourceBytes: number;
        decodedBytes: number;
        audioBufferId: string;
    }> = [];
    let totalDecodedBytes = 0;
    let totalDurationSeconds = 0;
    try {
        for (const file of files) {
            throwIfAborted(signal);
            const decoded = await decodeAudioFile(file);
            if (signal?.aborted === true) {
                releasePreviewAudioBuffer(decoded.id);
                throwIfAborted(signal);
            }
            const decodedBytes =
                decoded.buffer.length * decoded.buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
            totalDecodedBytes += decodedBytes;
            totalDurationSeconds += decoded.buffer.duration;
            if (decodedBytes > MAX_DECODED_BYTES_PER_STEM || totalDecodedBytes > MAX_TOTAL_DECODED_BYTES) {
                releasePreviewAudioBuffer(decoded.id);
                throw new Error('Decoded stem audio must stay within 256 MiB per stem and 1 GiB total.');
            }
            if (
                decoded.buffer.duration > MAX_DURATION_SECONDS_PER_STEM ||
                totalDurationSeconds > MAX_TOTAL_DURATION_SECONDS
            ) {
                releasePreviewAudioBuffer(decoded.id);
                throw new Error('Stem duration must stay within 1 hour per stem and 4 hours total.');
            }
            let sourceTempo: number | null;
            try {
                sourceTempo = detectTempo(decoded.id);
            } catch (error) {
                releasePreviewAudioBuffer(decoded.id);
                throw error;
            }
            if (sourceTempo === null || !Number.isFinite(sourceTempo) || sourceTempo < 20 || sourceTempo > 999) {
                releasePreviewAudioBuffer(decoded.id);
                throw new Error(`Could not determine a safe source tempo for "${file.name}".`);
            }
            const pendingStem = {
                stemId: `stem-${crypto.randomUUID()}`,
                sourceName: file.name,
                sourceTempo,
                durationSeconds: decoded.buffer.duration,
                sourceBytes: file.size,
                decodedBytes,
                audioBufferId: decoded.id,
            };
            prepared.push(pendingStem);
            throwIfAborted(signal);
        }
    } catch (error) {
        discardPreparedStemImportResources(prepared);
        throw error;
    }

    return {
        status: 'prepared' as const,
        selectionId: `stem-selection-${crypto.randomUUID()}`,
        projectTempo,
        stems: prepared,
        allowedRoles: [...STEM_ROLES] as StemImportRole[],
    };
}
