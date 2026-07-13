import { cacheAudioBuffer, getAudioContext } from '#/modules/AudioEngine/useCases';

export type DecodedDawProjectAssets = {
    bufferIdsByPath: Map<string, string>;
    failedPaths: string[];
};

export type DecodeDawProjectAssetsInput = {
    audioAssets: Map<string, Uint8Array>;
    shouldContinue?: () => boolean;
};

export async function decodeDawProjectAssets({
    audioAssets,
    shouldContinue,
}: DecodeDawProjectAssetsInput): Promise<DecodedDawProjectAssets> {
    const bufferIdsByPath = new Map<string, string>();
    const failedPaths: string[] = [];
    const decodedAssets: Array<{ path: string; bufferId: string; buffer: AudioBuffer }> = [];

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
        if (shouldContinue?.() === false) {
            break;
        }
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        try {
            const buffer = await context.decodeAudioData(copy.buffer);
            if (shouldContinue?.() === false) {
                break;
            }
            const id = `audio-${crypto.randomUUID()}`;
            decodedAssets.push({ path, bufferId: id, buffer });
        } catch {
            failedPaths.push(path);
        }
    }

    if (shouldContinue?.() === false) {
        return { bufferIdsByPath, failedPaths };
    }

    for (const { path, bufferId, buffer } of decodedAssets) {
        cacheAudioBuffer({ buffer, bufferId });
        bufferIdsByPath.set(path, bufferId);
    }

    return { bufferIdsByPath, failedPaths };
}
