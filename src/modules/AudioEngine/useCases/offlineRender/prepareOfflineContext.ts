import { SIDECHAIN_PROCESSOR_UNAVAILABLE_WARNING } from '../../repositories/devices/dynamics/createOfflineSidechainCompressor';
import { prepareOfflineSidechainCompressor } from '../../repositories/devices/dynamics/prepareOfflineSidechainCompressor';
import { prepareOfflineBitcrusherRate } from '../../repositories/devices/toneShaping/prepareOfflineBitcrusherRate';
import { acceptsSidechainInput } from '../deviceCapabilities/acceptsSidechainInput';

/**
 * Device types whose offline construction needs a worklet module that no device
 * factory registers for it.
 *
 * Every *native* DSP node registers its own module on whatever context it is
 * handed — `ensureWorkletRegistered(ctx, url)` in `workletInitShared` is
 * per-context and cached — so those devices need nothing here. These two do
 * not: `createOfflineSidechainCompressor` and `createBitcrusher` build their worklet
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
 * `createOfflineSidechainCompressor` reports through the `onWarning` stored on
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
    onWarning,
}: PrepareOfflineContextInput): Promise<void> {
    // Every sidechain compressor gets the worklet, keyed or not: live builds it
    // unconditionally, and with no key on input 1 it only applies Makeup, so an
    // unkeyed device must render the same way offline.
    const hasSidechainCompressor = tracks.some((track) =>
        track.devices.some((device) => acceptsSidechainInput(device.type) && !device.bypassed)
    );
    if (hasSidechainCompressor) {
        try {
            await prepareOfflineSidechainCompressor({ offlineCtx, onWarning });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            onWarning?.(`${SIDECHAIN_PROCESSOR_UNAVAILABLE_WARNING} ${reason}`);
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
