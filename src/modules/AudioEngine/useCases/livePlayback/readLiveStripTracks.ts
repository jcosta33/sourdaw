/**
 * Which strips a live native session builds, read off project truth (#3068).
 *
 * The Arrangement projection the Web Audio path already reads, so the two
 * engines cannot disagree about which strips a session has. It is its own file
 * because two callers need it — the play gesture and the sample prime — and a
 * prime that primed a different strip set from the one that plays would be a
 * pool that is right about a project nobody is rendering.
 */

import { shouldCreateLiveTrackStrip, trackStore } from '#/modules/Arrangement/stores';

import { type LiveGraphProgrammeInput } from './projectLiveGraphProgramme';

export function readLiveStripTracks(): LiveGraphProgrammeInput['stripTracks'] {
    return (trackStore.value?.tracks ?? []).filter((track) => !track.disabled && shouldCreateLiveTrackStrip(track));
}
