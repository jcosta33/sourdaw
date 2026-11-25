type PreparedOfflineSidechainCompressor = {
    onWarning?: (message: string) => void;
};

/** Contexts on which the sidechain worklet module is registered. */
export const preparedOfflineSidechainCompressors = new WeakMap<BaseAudioContext, PreparedOfflineSidechainCompressor>();

type PrepareOfflineSidechainCompressorInput = {
    offlineCtx: OfflineAudioContext;
    onWarning?: (message: string) => void;
};

export async function prepareOfflineSidechainCompressor({
    offlineCtx,
    onWarning,
}: PrepareOfflineSidechainCompressorInput): Promise<void> {
    await offlineCtx.audioWorklet.addModule('/audio/worklets/sidechain-compressor-processor.js');
    preparedOfflineSidechainCompressors.set(offlineCtx, { onWarning });
}
