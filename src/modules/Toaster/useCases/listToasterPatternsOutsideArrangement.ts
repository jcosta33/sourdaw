import { type Device, type Track } from '#/modules/Arrangement/stores';
import { type MidiNote } from '#/modules/MIDI/stores';

import { type Pattern } from '../models/ToasterKit';
import { fromToasterKitState } from '../models/ToasterKitState';

export type ToasterPatternOutsideArrangement = {
    trackId: string;
    trackName: string;
    deviceName: string;
};

type NotesByClipId = Readonly<Record<string, readonly MidiNote[]>>;

function isToasterDevice(device: Device): boolean {
    return device.type === 'toaster';
}

function patternHasActiveStep(pattern: Pattern): boolean {
    return pattern.tracks.some((patternTrack) => patternTrack.steps.some((step) => step.active));
}

function trackHasBakedNotes(track: Track, notesByClipId: NotesByClipId): boolean {
    return track.clips.some((clip) => (notesByClipId[clip.id]?.length ?? 0) > 0);
}

/**
 * Toaster devices whose active pattern has a live hit that was never baked to
 * the arrangement via **To timeline** (`exportPatternToTimeline.ts`) — the
 * only export/native-playback-visible form of a pattern (ADR 0045). A pattern
 * with no active step has nothing to bake and is not reported; a pattern
 * already baked onto the owning track or one of its pad-child tracks is
 * covered regardless of whether that bake is still current.
 */
export function listToasterPatternsOutsideArrangement(input: {
    tracks: readonly Track[];
    notesByClipId: NotesByClipId;
}): ToasterPatternOutsideArrangement[] {
    const { tracks, notesByClipId } = input;
    const entries: ToasterPatternOutsideArrangement[] = [];

    for (const track of tracks) {
        const childTracks = tracks.filter((candidate) => candidate.parentId === track.id);

        for (const device of track.devices) {
            if (!isToasterDevice(device)) {
                continue;
            }

            const kit = fromToasterKitState(device.deviceState);
            const activePattern = kit.patterns.find((pattern) => pattern.id === kit.activePatternId);
            if (!activePattern || !patternHasActiveStep(activePattern)) {
                continue;
            }

            const isBaked =
                trackHasBakedNotes(track, notesByClipId) ||
                childTracks.some((childTrack) => trackHasBakedNotes(childTrack, notesByClipId));
            if (isBaked) {
                continue;
            }

            entries.push({ trackId: track.id, trackName: track.name, deviceName: device.name });
        }
    }

    return entries;
}
