import { audioBufferToFlac as encode } from '../repositories/audioEncoders/flacEncoder';

/**
 * Encode an `AudioBuffer` to a FLAC byte stream.
 *
 * Public boundary over the FLAC encoder repository — consumers depend on this
 * use case rather than reaching into `repositories/audioEncoders/`.
 */
export function audioBufferToFlac(
    buffer: AudioBuffer,
    onProgress?: (frac: number) => void
): Promise<Uint8Array> {
    return encode(buffer, onProgress);
}
