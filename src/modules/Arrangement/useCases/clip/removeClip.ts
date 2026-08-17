import { removeMidiClipData } from '#/modules/MIDI/useCases';

import { mapAllTracks } from '../../repositories/track/mapAllTracks';

import { removeClipSatelliteData } from './removeClipSatelliteData';

export function removeClip(clipId: string): void {
    mapAllTracks((time) => ({ ...time, clips: time.clips.filter((context) => context.id !== clipId) }));
    removeMidiClipData([clipId]);

    // Everything else keyed by the retired clip id: clip-scoped automation
    // lanes, gain envelope, warp state, clipboard entries, and the ephemeral
    // drag-preview and active-recording refs.
    removeClipSatelliteData([clipId]);
}
