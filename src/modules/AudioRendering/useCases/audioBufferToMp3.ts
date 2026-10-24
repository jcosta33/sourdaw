import { type PcmDitherOptions } from '../repositories/audioEncoders/convertFloatChannelsToPcm';
import { audioBufferToMp3 as encode } from '../repositories/audioEncoders/mp3Encoder';
import { writePodcastId3 } from '../repositories/audioEncoders/writePodcastId3';

/**
 * Encode an `AudioBuffer` to an MP3 byte stream at the given bitrate.
 *
 * Public boundary over the MP3 encoder repository — consumers depend on this
 * use case rather than reaching into `repositories/audioEncoders/`.
 */
export async function audioBufferToMp3(
    buffer: AudioBuffer,
    bitRate = 128,
    onProgress?: (frac: number) => void,
    dither?: PcmDitherOptions,
    metadata?: Parameters<typeof writePodcastId3>[0]['metadata']
): Promise<Uint8Array> {
    // Validate before starting the encoder as well as at the dialog's admission boundary.
    const tag = metadata ? writePodcastId3({ metadata, encodedBytes: new Uint8Array() }) : undefined;
    const bytes = await encode(buffer, bitRate, onProgress, dither);
    if (!tag || tag.length === 0) {
        return bytes;
    }
    const tagged = new Uint8Array(tag.length + bytes.length);
    tagged.set(tag);
    tagged.set(bytes, tag.length);
    return tagged;
}
