export const preparedOfflineSidechainCompressorContexts = new WeakSet<BaseAudioContext>();

export async function prepareOfflineSidechainCompressor(offlineCtx: OfflineAudioContext): Promise<void> {
    await offlineCtx.audioWorklet.addModule('/audio/worklets/sidechain-compressor-processor.js');
    preparedOfflineSidechainCompressorContexts.add(offlineCtx);
}
