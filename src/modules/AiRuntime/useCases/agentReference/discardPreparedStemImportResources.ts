import { releasePreviewAudioBuffer } from '#/modules/AudioEngine/useCases';

type PreparedStemResource = {
    audioBufferId: string;
};

export function discardPreparedStemImportResources(stems: readonly PreparedStemResource[]): void {
    for (const stem of stems) {
        releasePreviewAudioBuffer(stem.audioBufferId);
    }
}
