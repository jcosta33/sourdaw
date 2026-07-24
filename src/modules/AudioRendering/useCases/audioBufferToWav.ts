import { type PcmDitherOptions } from '../repositories/audioEncoders/convertFloatChannelsToPcm';
import { audioBufferToWav as encode } from '../repositories/audioEncoders/wavEncoder';

/**
 * Encode an `AudioBuffer` to a WAV byte stream.
 *
 * Public boundary over the WAV encoder repository — consumers depend on this
 * use case rather than reaching into `repositories/audioEncoders/`.
 */
export function audioBufferToWav(
    buffer: AudioBuffer,
    bitDepth: 16 | 24 | 32 = 16,
    onProgress?: (frac: number) => void,
    dither?: PcmDitherOptions
): Promise<ArrayBuffer> {
    return encode(buffer, bitDepth, onProgress, dither);
}
