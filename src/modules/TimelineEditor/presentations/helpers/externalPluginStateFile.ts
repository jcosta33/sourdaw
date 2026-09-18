import { bytesToBase64 } from '#/utils/base64';

/**
 * Read one user-chosen file as the opaque plugin state chunk the
 * `setExternalPluginState` action stores on the device: the same base64
 * encoding of the raw state bytes that save and restore use. Native plugin
 * editors save arbitrary preset formats, so any file is accepted and its raw
 * bytes become the chunk.
 */
export async function readExternalPluginStateChunk(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return bytesToBase64(bytes);
}
