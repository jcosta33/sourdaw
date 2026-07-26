import { WEB_LOD } from '../repositories/sampleLoader/helpers';
import { loadInstrumentFromManifest } from '../repositories/sampleLoader/loadInstrumentFromManifest';
import { resolveSampleBasePath } from '../repositories/sampleLoader/resolveSampleBasePath';

export type LoadLevainSamplesIntoPortInput = {
    /** The worklet port of the Levain instance to load zones into. */
    port: MessagePort;
    /** Instrument whose manifest supplies the zones. */
    instrumentId: string;
};

/**
 * Load an instrument's zones into one Levain worklet instance and resolve when
 * the engine can actually play it.
 *
 * This is the engine half of what `registerLevainDevice` does, with none of the
 * live-runtime bookkeeping and none of the UI progress writes. It exists because
 * those two halves have different audiences:
 *
 * - Live registration is deliberately fire-and-forget (`loadSamplesForInstrument`
 *   returns `void` and drops the promise in a `.finally`). Real-time playback can
 *   afford to start silent and fill in when the samples land.
 * - An offline render cannot. `OfflineAudioContext` renders faster than real time,
 *   so an un-awaited load never arrives and the export writes silence.
 *
 * Both callers therefore need the same engine work but a different completion
 * contract, so the engine work lives here and each caller supplies its own. This
 * function is the one that resolves only once `buildZoneMap` has been posted.
 *
 * Loading also *arms the fallback tone*, which is not incidental: the fallback is
 * constructed `enabled: false` (`levain/fallback.rs:100`) and only `clear_zones()`
 * turns it on (`levain/engine.rs:112`). An instance that never begins a load has
 * neither zones nor fallback and renders digital silence, measured at peak
 * 0.000000 with zero voices.
 */
export async function loadLevainSamplesIntoPort({ port, instrumentId }: LoadLevainSamplesIntoPortInput): Promise<void> {
    const basePath = await resolveSampleBasePath(instrumentId);
    await loadInstrumentFromManifest(`${basePath}/manifest.json`, basePath, port, WEB_LOD);
}
