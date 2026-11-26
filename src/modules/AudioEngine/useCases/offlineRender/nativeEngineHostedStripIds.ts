import { type Track } from '#/modules/Arrangement/stores';

/**
 * The strips whose engine-compensated devices the native engine holds in a
 * native export: all of them, buses included, because the engine hosts every
 * strip of that render and a bus deepens every route through it.
 */
export function nativeEngineHostedStripIds(renderableTracks: readonly Pick<Track, 'id'>[]): ReadonlySet<string> {
    return new Set(renderableTracks.map((track) => track.id));
}
