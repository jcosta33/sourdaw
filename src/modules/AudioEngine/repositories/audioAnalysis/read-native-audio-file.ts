import { basename_from_path } from '#/utils/path-basename';
import { readFileBytes } from '#/utils/tauriBridge';

type ReadNativeAudioFileInput = {
    path: string;
};

type ReadNativeAudioFileOutput = Promise<File>;

/**
 * Read a file the native side wrote and hand it back as a `File`.
 *
 * `File` rather than raw bytes because that is what the engine's decoder takes,
 * and going through the decoder is the point: it tries Web Audio first and falls
 * back to the Symphonia WASM decoder, so a native render lands in this realm
 * through the same path as an imported file rather than a second, weaker one.
 */
export async function readNativeAudioFile({ path }: ReadNativeAudioFileInput): ReadNativeAudioFileOutput {
    const bytes = await readFileBytes({ path });

    // Copied into a fresh ArrayBuffer rather than handed over as the view: the bridge
    // types its bytes over `ArrayBufferLike`, which a `BlobPart` will not accept, and
    // this narrows it without a cast.
    const fileBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(fileBuffer).set(bytes);

    return new File([fileBuffer], basename_from_path(path) || path);
}
