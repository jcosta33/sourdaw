import { getAudioContext, serializeAudioBuffersForProject } from '#/modules/AudioEngine/useCases';

type DecodedProjectAudioBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    channelData: string[];
};

export type DecodedDawProjectAssets = {
    audioBuffers: Record<string, DecodedProjectAudioBuffer>;
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
        return { audioBuffers: {}, bufferIdsByPath, failedPaths };
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
        return { audioBuffers: {}, bufferIdsByPath, failedPaths };
    }

    const audioBuffers =
        decodedAssets.length > 0
            ? await serializeAudioBuffersForProject({
                  buffers: decodedAssets.map(({ bufferId, buffer }) => ({ id: bufferId, buffer })),
              })
            : {};
    if (shouldContinue?.() === false) {
        return { audioBuffers: {}, bufferIdsByPath, failedPaths };
    }
    for (const { path, bufferId } of decodedAssets) {
        bufferIdsByPath.set(path, bufferId);
    }

    return { audioBuffers, bufferIdsByPath, failedPaths };
}
