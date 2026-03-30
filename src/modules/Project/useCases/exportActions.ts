/**
 * Export Actions — use case wrappers for cross-module calls
 * used by the ExportDialog presentation view.
 */
import {
    renderOffline as _renderOffline,
    exportStems as _exportStems,
    cancelExport as _cancelExport,
    audioBufferToWav,
    audioBufferToMp3,
    audioBufferToFlac,
    type OfflineRenderOptions,
} from '#/modules/AudioEngine/useCases/offlineRender';

export type { OfflineRenderOptions };

export const renderOffline = (opts: OfflineRenderOptions): Promise<AudioBuffer> =>
    _renderOffline(opts);

export const exportStems = (opts: OfflineRenderOptions): Promise<Map<string, AudioBuffer>> =>
    _exportStems(opts);

export const cancelExport = (): void => _cancelExport();

export const encodeWav = (
    buffer: AudioBuffer,
    bitDepth?: 16 | 24 | 32,
    onProgress?: (frac: number) => void
): Promise<ArrayBuffer> => audioBufferToWav(buffer, bitDepth, onProgress);

export const encodeMp3 = (
    buffer: AudioBuffer,
    bitRate?: number,
    onProgress?: (frac: number) => void
): Promise<Uint8Array> => audioBufferToMp3(buffer, bitRate, onProgress);

export const encodeFlac = (
    buffer: AudioBuffer,
    onProgress?: (frac: number) => void
): Promise<Uint8Array> => audioBufferToFlac(buffer, onProgress);
