import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getAudioContext } from '#/modules/AudioEngine/useCases';

export type DecodedDawProjectAssets = {
    bufferIdsByPath: Map<string, string>;
    failedPaths: string[];
};

export async function decodeDawProjectAssets(audioAssets: Map<string, Uint8Array>): Promise<DecodedDawProjectAssets> {
    const bufferIdsByPath = new Map<string, string>();
    const failedPaths: string[] = [];

    const context = getAudioContext();
    if (!context || audioAssets.size === 0) {
        if (audioAssets.size > 0) {
            for (const path of audioAssets.keys()) {
                failedPaths.push(path);
            }
        }
        return { bufferIdsByPath, failedPaths };
    }

    for (const [path, bytes] of audioAssets) {
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        try {
            const buffer = await context.decodeAudioData(copy.buffer);
            const id = `audio-${crypto.randomUUID()}`;
            audioBufferCache.set(id, buffer);
            bufferIdsByPath.set(path, id);
        } catch {
            failedPaths.push(path);
        }
    }

    return { bufferIdsByPath, failedPaths };
}
