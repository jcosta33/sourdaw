import { prepareOfflineSidechainCompressor } from '../../repositories/devices/dynamics/prepareOfflineSidechainCompressor';
import { prepareOfflineBitcrusherRate } from '../../repositories/devices/toneShaping/prepareOfflineBitcrusherRate';

/**
 * Device types whose offline construction needs a worklet module that no device
 * factory registers for it.
 *
 * Every *native* DSP node registers its own module on whatever context it is
 * handed — `ensureWorkletRegistered(ctx, url)` in `workletInitShared` is
 * per-context and cached — so those devices need nothing here. These two do
 * not: `createSidechainCompressor` and `createBitcrusher` build their worklet
 * node *synchronously* inside the strip, so the module has to already be in the
 * context's name-to-descriptor map by the time `createOfflineTrackStrip` runs.
 * Registration is per-`BaseAudioContext` (the map is populated by
 * `AudioWorklet.addModule()` resolving and `registerProcessor()` running in that
 * context's global scope), so every offline context needs its own.
 *
 * Exported because `__tests__/offlineContextPreparation.spec.ts` enumerates the
 * census population from here rather than from a list written beside it.
 */
export const OUT_OF_BAND_OFFLINE_MODULE_DEVICE_TYPES = ['builtin-sidechain-compressor', 'builtin-bitcrusher'] as const;

export type PrepareOfflineContextInput = {
    offlineCtx: OfflineAudioContext;
    /**
     * Every track whose strip will be built on this context. Read for device
     * types only — the prepare is skipped when nothing needs it, so an ordinary
     * export pays no module fetch.
     */
    tracks: readonly { readonly devices: readonly { readonly type: string; readonly bypassed: boolean }[] }[];
    /**
     * The compressor devices this render will actually key, already planned by
     * the caller. Route selection genuinely differs per path — the mixdown
     * scans every route, stems plan per stem group, freeze scans its own
     * subgraph — so it stays with the caller; what is shared is the
     * registration, the warning text and the failure handling.
     *
     * An empty set means no compressor in this render is keyed, and the
     * sidechain module is not fetched.
     */
    sidechainTargetDevices?: ReadonlySet<object>;
    onWarning?: (message: string) => void;
};

/**
 * Register every out-of-band worklet module an offline render's strips will
 * need, on the context those strips will be built on.
 *
 * **Why this is one function rather than three copies.** Before this existed,
 * `renderOffline` and `exportStems` each carried their own copy of the two
 * prepares — same order, same try/catch, same warning strings — and
 * `renderTrackSubgraphOffline`, the freeze and bounce path, carried neither. So
 * freezing a track that carried a sidechain compressor baked ordinary
 * self-keyed compression (the ducking vanished) and freezing a bitcrusher baked
 * bit-depth reduction with no rate decimation. Both degradations were silent:
 * `createSidechainCompressorFallback` reports through the `onWarning` stored on
 * the `prepared` record, and on an unprepared context that record was never
 * created, so there was nothing to report through.
 *
 * **No degradation here is silent.** A module that fails to resolve — a real
 * browser can fail `addModule` — reaches `onWarning` and the render continues
 * with the fallback, which is the caller's decision to surface. What is not
 * permitted is a fallback nobody is told about.
 */
export async function prepareOfflineContext({
    offlineCtx,
    tracks,
    sidechainTargetDevices,
    onWarning,
}: PrepareOfflineContextInput): Promise<void> {
    if (sidechainTargetDevices && sidechainTargetDevices.size > 0) {
        try {
            await prepareOfflineSidechainCompressor({
                offlineCtx,
                onWarning,
                targetDevices: sidechainTargetDevices,
            });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            onWarning?.(`Sidechain processor unavailable; using the offline compressor fallback. ${reason}`);
        }
    }

    const hasBitcrusher = tracks.some((track) =>
        track.devices.some((device) => device.type === 'builtin-bitcrusher' && !device.bypassed)
    );
    if (hasBitcrusher) {
        try {
            await prepareOfflineBitcrusherRate(offlineCtx);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            onWarning?.(`Bitcrusher rate reduction unavailable; rendering without it. ${reason}`);
        }
    }
}
