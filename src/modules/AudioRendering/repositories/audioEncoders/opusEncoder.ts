import { type ExportAudioSource, type ExportByteWriter } from '../../models/ExportAudioSource';

import { encodeOggAudio } from './encodeOggAudio';

export function audioBufferToOpus(
    source: ExportAudioSource,
    onProgress: ((fraction: number) => void) | undefined,
    writer: ExportByteWriter,
    signal?: AbortSignal
): Promise<void> {
    return encodeOggAudio({ codec: 'opus', source, onProgress, writer, signal });
}
