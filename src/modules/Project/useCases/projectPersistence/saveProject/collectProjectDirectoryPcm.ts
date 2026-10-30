import { exportCachedAudioBuffers, getAudioContext, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { base64ToBytes } from '#/utils/base64';

/** Read referenced PCM, including inactive alternatives evicted from the runtime cache. */
export async function collectProjectDirectoryPcm(
    bufferIds: readonly string[],
    shouldContinue: () => boolean
): Promise<Map<string, AudioBuffer>> {
    const buffers = new Map<string, AudioBuffer>();
    const missing: string[] = [];
    for (const bufferId of bufferIds) {
        const cached = getCachedAudioBuffer({ bufferId });
        if (cached) {
            buffers.set(bufferId, cached);
        } else {
            missing.push(bufferId);
        }
    }
    if (missing.length === 0) {
        return buffers;
    }
    const exported = await exportCachedAudioBuffers({ bufferIds: missing });
    if (!shouldContinue()) {
        throw new Error('Project changed while evicted PCM was read');
    }
    const context = getAudioContext();
    for (const bufferId of missing) {
        const source = exported[bufferId];
        if (!source || source.numberOfChannels !== source.channelData.length || source.numberOfChannels < 1) {
            throw new Error(`Required project PCM is unavailable: ${bufferId}`);
        }
        const channels = source.channelData.map((encoded) => {
            const bytes = base64ToBytes(encoded);
            if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
                throw new Error(`Required project PCM has invalid sample bytes: ${bufferId}`);
            }
            return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
        });
        const length = channels[0]?.length;
        if (!length || channels.some((channel) => channel.length !== length)) {
            throw new Error(`Required project PCM channel lengths differ: ${bufferId}`);
        }
        const buffer = context.createBuffer(channels.length, length, source.sampleRate);
        for (const [index, channel] of channels.entries()) {
            const samples = new Float32Array(channel.length);
            samples.set(channel);
            buffer.copyToChannel(samples, index);
        }
        buffers.set(bufferId, buffer);
    }
    return buffers;
}
