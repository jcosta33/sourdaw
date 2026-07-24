import { type PcmDitherOptions } from '../repositories/audioEncoders/convertFloatChannelsToPcm';
import { audioBufferToFlac as encode, type FlacBitDepth } from '../repositories/audioEncoders/flacEncoder';

/**
 * Encode an `AudioBuffer` to a FLAC byte stream at the requested bit depth.
 *
 * Public boundary over the FLAC encoder repository — consumers depend on this
 * use case rather than reaching into `repositories/audioEncoders/`.
 */
export function audioBufferToFlac(
    buffer: AudioBuffer,
    bitDepth: FlacBitDepth = 16,
    onProgress?: (frac: number) => void,
    dither?: PcmDitherOptions
): Promise<Uint8Array> {
    return encode(buffer, bitDepth, onProgress, dither);
}
