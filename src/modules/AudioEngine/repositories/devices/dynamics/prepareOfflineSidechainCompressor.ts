export const preparedOfflineSidechainCompressorTargets = new WeakMap<BaseAudioContext, ReadonlySet<string>>();

export async function prepareOfflineSidechainCompressor(
    offlineCtx: OfflineAudioContext,
    targetDeviceIds: ReadonlySet<string>
): Promise<void> {
    await offlineCtx.audioWorklet.addModule('/audio/worklets/sidechain-compressor-processor.js');
    preparedOfflineSidechainCompressorTargets.set(offlineCtx, new Set(targetDeviceIds));
}
