type PreparedOfflineSidechainCompressor = {
    onWarning?: (message: string) => void;
    targets: WeakSet<object>;
};

export const preparedOfflineSidechainCompressors = new WeakMap<BaseAudioContext, PreparedOfflineSidechainCompressor>();

type PrepareOfflineSidechainCompressorInput = {
    offlineCtx: OfflineAudioContext;
    onWarning?: (message: string) => void;
    targetDevices: ReadonlySet<object>;
};

export async function prepareOfflineSidechainCompressor({
    offlineCtx,
    onWarning,
    targetDevices,
}: PrepareOfflineSidechainCompressorInput): Promise<void> {
    await offlineCtx.audioWorklet.addModule('/audio/worklets/sidechain-compressor-processor.js');
    preparedOfflineSidechainCompressors.set(offlineCtx, { onWarning, targets: new WeakSet(targetDevices) });
}
