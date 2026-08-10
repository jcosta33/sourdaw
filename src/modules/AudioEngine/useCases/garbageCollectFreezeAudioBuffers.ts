import { audioBufferCache } from '../stores/audioBufferCache';

type GarbageCollectFreezeAudioBuffersInput = {
    activeBufferIds: Set<string>;
    projectId: number;
};

type GarbageCollectFreezeAudioBuffersOutput = Promise<void>;

export function garbageCollectFreezeAudioBuffers({
    activeBufferIds,
    projectId,
}: GarbageCollectFreezeAudioBuffersInput): GarbageCollectFreezeAudioBuffersOutput {
    return audioBufferCache.garbageCollectFreezeFiles({ activeIds: activeBufferIds, projectId });
}
