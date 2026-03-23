/**
 * Export Actions — use case wrappers for cross-module calls
 * used by the ExportDialog presentation view.
 */
import {
    renderOffline as _renderOffline,
    exportStems as _exportStems,
    downloadWav as _downloadWav,
    downloadMp3 as _downloadMp3,
    downloadFlac as _downloadFlac,
} from '#/modules/AudioEngine/useCases/offlineRender';

export const renderOffline = (lengthBeats: number, sampleRate?: number): Promise<AudioBuffer> =>
    _renderOffline(lengthBeats, sampleRate);

export const exportStems = (lengthBeats: number, sampleRate?: number): Promise<Map<string, AudioBuffer>> =>
    _exportStems(lengthBeats, sampleRate);

export const downloadWav = (
    buffer: AudioBuffer,
    filename: string,
    bitDepth?: 16 | 24 | 32,
    onProgress?: (frac: number) => void
): Promise<void> => _downloadWav(buffer, filename, bitDepth, onProgress);

export const downloadMp3 = (
    buffer: AudioBuffer,
    filename: string,
    bitRate?: number,
    onProgress?: (frac: number) => void
): Promise<void> => _downloadMp3(buffer, filename, bitRate, onProgress);

export const downloadFlac = (
    buffer: AudioBuffer,
    filename: string,
    onProgress?: (frac: number) => void
): Promise<void> => _downloadFlac(buffer, filename, onProgress);
