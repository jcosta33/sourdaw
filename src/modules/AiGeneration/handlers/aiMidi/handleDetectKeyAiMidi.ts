import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';
import { detectKey as detectBufferKey } from '#/modules/AudioAnalysis/useCases';
import { createHandler } from '#/utils/createHandler';

function getClipAudioBufferId(clipId: string): string | null {
    const clip = trackStore.value?.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    return clip?.type === 'audio' ? (clip.audioBufferId ?? null) : null;
}

export const handleDetectKeyAiMidi = createHandler<'detectKey'>({
    execute: async (a) => {
        const audioBufferId = getClipAudioBufferId(a.payload.clipId);
        const result = audioBufferId ? detectBufferKey(audioBufferId) : null;
        const key = result ? `${result.key} ${result.mode === 'major' ? 'Major' : 'Minor'}` : null;
        logger.info(`[Analysis] Key detected for clip ${a.payload.clipId}: ${String(key)}`);
    },
    describe: () => ({ label: 'Detect key' }),
    undoable: false,
});
