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
    'crumbs',
    'drum-kit',
    'builtin-drum-kit',
    // Yeast produces no audio, but the offline scheduler keys note projection
    // off its presence on the track, so it must survive the insert filter.
    'yeast',
]);

export function isOfflineInstrumentDevice(deviceType: string): boolean {
    return (
        OFFLINE_INSTRUMENT_DEVICE_TYPES.has(deviceType) ||
        deviceType.startsWith('builtin-drum-machine') ||
        deviceType.startsWith('faust-')
    );
}
