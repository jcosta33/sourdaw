import { isFaustInstrumentModule } from '#/modules/PluginHost/useCases';

/**
 * Device types that are sound *sources* in an offline render rather than
 * pass-through inserts.
 *
 * A bounce with `includeInserts: false` drops the track's effect chain, but it
 * must keep whatever actually makes the sound — otherwise bouncing a Fermenter
 * or Toaster track without inserts renders silence instead of a dry instrument
 * take (MD-4).
 */
const OFFLINE_INSTRUMENT_DEVICE_TYPES = new Set([
    'fermenter',
    'grand-boule',
    'levain',
    'toaster',
    // The catalog id carries the `builtin-` prefix (CrumbsDescriptor). This
    // entry read bare `crumbs`, which no device ever has, so the guard never
    // fired and a dry bounce dropped the sampler instead of keeping it.
    'builtin-crumbs',
    'drum-kit',
    'builtin-drum-kit',
    // Yeast produces no audio, but the offline scheduler keys note projection
    // off its presence on the track, so it must survive the insert filter.
    'yeast',
]);

export function isOfflineInstrumentDevice(deviceType: string): boolean {
    if (OFFLINE_INSTRUMENT_DEVICE_TYPES.has(deviceType) || deviceType.startsWith('builtin-drum-machine')) {
        return true;
    }
    // A Faust device id is the module id, and `registerFaustDSP` records
    // whether that module is an instrument. Matching the `faust-` prefix would
    // keep every Faust *effect* too, so a dry bounce would come back wet.
    return isFaustInstrumentModule(deviceType);
}
