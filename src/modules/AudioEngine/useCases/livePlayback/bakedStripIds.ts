/**
 * The strips a bake speaks for, out of the ones a session builds (#3068).
 *
 * Every live producer has to agree about this set. The audio programme replaces
 * such a strip's playback with the bake, the carrier law reads it, and the MIDI
 * producer must not send notes to an instrument whose output the bake already
 * carries — one part printed twice is the failure it prevents.
 */

import { type Track } from '#/modules/Arrangement/stores';

import { frozenBake } from './frozenBake';

export type BakedStripIdsInput = Readonly<{
    stripTracks: readonly Track[];
    /** Decoded material by id — `audioBufferCache.get` in production. */
    readBuffer: (bufferId: string) => AudioBuffer | undefined;
}>;

export function bakedStripIds(input: BakedStripIdsInput): ReadonlySet<string> {
    return new Set(
        input.stripTracks
            .filter((track) => frozenBake({ track, readBuffer: input.readBuffer }) !== null)
            .map((track) => track.id)
    );
}
