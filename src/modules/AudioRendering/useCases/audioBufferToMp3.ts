import { type PcmDitherOptions } from '../repositories/audioEncoders/convertFloatChannelsToPcm';
import { audioBufferToMp3 as encode } from '../repositories/audioEncoders/mp3Encoder';

/**
 * Encode an `AudioBuffer` to an MP3 byte stream at the given bitrate.
 *
 * Public boundary over the MP3 encoder repository — consumers depend on this
 * use case rather than reaching into `repositories/audioEncoders/`.
 */
export function audioBufferToMp3(
    buffer: AudioBuffer,
    bitRate = 128,
    onProgress?: (frac: number) => void,
    dither?: PcmDitherOptions
): Promise<Uint8Array> {
    return encode(buffer, bitRate, onProgress, dither);
}
