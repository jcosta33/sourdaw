/**
 * The default track name law: a track created without a name is called "<Kind label> N", where N
 * is one more than the highest number among tracks of the same kind already called "<Kind label>"
 * or "<Kind label> N", as Logic and Studio One number new tracks per kind. A bare label counts as 1,
 * because tracks created before this law ("MIDI", "Audio") stand for the first of their kind. A name
 * is a default only beside its own kind: an audio track the user called "Bus 1" chose that name.
 */

import { type TrackKind } from './Track';

const TRACK_KIND_LABELS = {
    audio: 'Audio',
    midi: 'MIDI',
    bus: 'Bus',
    folder: 'Folder',
    master: 'Master',
} as const satisfies Record<TrackKind, string>;

const DEFAULT_TRACK_NAME_PATTERN = new RegExp(`^(${Object.values(TRACK_KIND_LABELS).join('|')})(?: (\\d+))?$`);

type NamedTrack = { readonly kind: string; readonly name: string };

/** Whether the track's name is one this law assigns to its kind: the kind's bare label or its label and a number. */
export function isDefaultTrackName(track: { readonly kind: TrackKind; readonly name: string }): boolean {
    return readDefaultTrackNumber(track, track.kind) !== null;
}

function readDefaultTrackNumber(track: NamedTrack, kind: TrackKind): number | null {
    if (track.kind !== kind) {
        return null;
    }
    const match = DEFAULT_TRACK_NAME_PATTERN.exec(track.name);
    if (match?.[1] !== TRACK_KIND_LABELS[kind]) {
        return null;
    }
    const number = match[2] === undefined ? 1 : Number(match[2]);
    return Number.isSafeInteger(number) ? number : null;
}

/** The default name for a new track of `kind` among `tracks`, the project's tracks in creation order. */
export function nextDefaultTrackName(kind: TrackKind, tracks: readonly NamedTrack[]): string {
    let highest = 0;
    for (const track of tracks) {
        highest = Math.max(highest, readDefaultTrackNumber(track, kind) ?? 0);
    }
    return `${TRACK_KIND_LABELS[kind]} ${String(highest + 1)}`;
}
