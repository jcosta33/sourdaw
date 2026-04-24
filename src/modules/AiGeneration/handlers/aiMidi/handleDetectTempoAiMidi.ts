import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';
import { detectTempo as detectBufferTempo } from '#/modules/AudioAnalysis/useCases';
import { createHandler } from '#/utils/createHandler';

function getClipAudioBufferId(clipId: string): string | null {
    const clip = trackStore.value?.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    return clip?.type === 'audio' ? (clip.audioBufferId ?? null) : null;
}

export const handleDetectTempoAiMidi = createHandler<'detectTempo'>({
    execute: async (a) => {
        const audioBufferId = getClipAudioBufferId(a.payload.clipId);
        const bpm = audioBufferId ? detectBufferTempo(audioBufferId) : null;
        logger.info(`[Analysis] Tempo detected for clip ${a.payload.clipId}: ~${String(bpm)} BPM`);
    },
    describe: () => ({ label: 'Detect tempo' }),
    undoable: false,
});
