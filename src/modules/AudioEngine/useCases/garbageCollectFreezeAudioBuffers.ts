import { audioBufferCache } from '../stores/audioBufferCache';

type GarbageCollectFreezeAudioBuffersInput = {
    activeBufferIds: Set<string>;
};

type GarbageCollectFreezeAudioBuffersOutput = Promise<void>;

export function garbageCollectFreezeAudioBuffers({
    activeBufferIds,
}: GarbageCollectFreezeAudioBuffersInput): GarbageCollectFreezeAudioBuffersOutput {
    return audioBufferCache.garbageCollectFreezeFiles(activeBufferIds);
}
