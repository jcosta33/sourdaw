import { getAssetTransfer } from '#/modules/Collaboration/useCases';

import { audioBufferToWav } from './audioBufferToWav';

export type StagedAudioBufferAsset = { hash: string; leaseId: string };

/**
 * Encode an `AudioBuffer` to WAV bytes and stage them with the collaboration
 * asset owner, producing the shareable identity a clip can carry as its
 * `assetHash`.
 *
 * Buffers that exist only in the audio cache — imported sidebar samples,
 * generated AI renders — have no `File` to hand `stageLocalAsset`, so the
 * bytes a peer will verify and decode must be encoded here first. A staged
 * lease is a loan, not a commit: promote it once a clip carrying the hash is
 * committed, release it when the insertion is abandoned.
 *
 * Returns `null` when the collaboration use cases have no asset owner to
 * stage with. A real staging failure throws; callers must not publish a
 * shareable clip without the identity it was promised (#3759).
 */
export async function stageAudioBufferAsset(buffer: AudioBuffer, name: string): Promise<StagedAudioBufferAsset | null> {
    const assetTransfer = getAssetTransfer();
    if (!assetTransfer) {
        return null;
    }
    const bytes = await audioBufferToWav(buffer);
    const staged = await assetTransfer.stageLocalAsset(new Blob([bytes], { type: 'audio/wav' }), name);
    return { hash: staged.hash, leaseId: staged.leaseId };
}
