import { batchStoreUpdates } from '#/infra/store/createStore';
import { pushUndoEntry, REDO_NOT_APPLIED } from '#/modules/Command/useCases';
import { mergeImportedMidiClipNotes, readMidiFile } from '#/modules/MIDI/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { collectTrackClipIds } from '../services/collectTrackClipIds';
import { type Clip, type Track, type TrackStoreState } from '../stores/trackStore';

import { createTrack } from './createTrack';
import { getNextClipId } from './getNextClipId';
import { getTrackStoreState } from './getTrackStoreState';
import { setTrackState } from './setTrackState';

type ApplyImportedTracksInput = {
    tracks: Track[];
    identities: ImportedTrackIdentities;
};

type ImportedTrackIdentities = {
    trackIds: ReadonlySet<string>;
    clipIds: ReadonlySet<string>;
};

type ImportMidiFileOptions = {
    shouldContinue: () => boolean;
};

type ImportMidiFileOutput = 'completed' | 'superseded';

function getImportedTrackIdentities(tracks: readonly Track[]): ImportedTrackIdentities | null {
    const trackIds = new Set<string>();
    const clipIds = new Set<string>();

    for (const track of tracks) {
        if (trackIds.has(track.id)) {
            return null;
        }
        trackIds.add(track.id);

        for (const clip of track.clips) {
            if (clip.trackId !== track.id || clipIds.has(clip.id)) {
                return null;
            }
            clipIds.add(clip.id);
        }
    }

    return { trackIds, clipIds };
}

function hasImportedIdentityCollision(state: TrackStoreState, identities: ImportedTrackIdentities): boolean {
    return (
        state.ghostClips?.some((clip) => identities.clipIds.has(clip.id)) === true ||
        state.tracks.some(
            (track) =>
                identities.trackIds.has(track.id) ||
                collectTrackClipIds(track).some((clipId) => identities.clipIds.has(clipId))
        )
    );
}

function canApplyImportedTracks(identities: ImportedTrackIdentities): boolean {
    const state = getTrackStoreState();
    return state !== null && !hasImportedIdentityCollision(state, identities);
}

function applyImportedTracks({ tracks, identities }: ApplyImportedTracksInput): boolean {
    const state = getTrackStoreState();
    if (!state || hasImportedIdentityCollision(state, identities)) {
        return false;
    }

    setTrackState({ ...state, tracks: [...state.tracks, ...tracks] });
    return true;
}

function removeImportedTracks(identities: ImportedTrackIdentities): void {
    const state = getTrackStoreState();
    if (!state) {
        return;
    }

    setTrackState({
        ...state,
        tracks: state.tracks.filter((track) => !identities.trackIds.has(track.id)),
        selectedTrackId:
            state.selectedTrackId && identities.trackIds.has(state.selectedTrackId) ? null : state.selectedTrackId,
    });
}

export async function importMidiFile(
    file: File,
    { shouldContinue }: ImportMidiFileOptions
): Promise<ImportMidiFileOutput> {
    let parsedTracks: Awaited<ReturnType<typeof readMidiFile>>;
    try {
        parsedTracks = await readMidiFile(file);
    } catch {
        if (!shouldContinue()) {
            return 'superseded';
        }
        notifyUser(`Failed to import "${file.name}" - invalid or corrupt MIDI file`, 'error');
        return 'completed';
    }
    if (!shouldContinue()) {
        return 'superseded';
    }
    if (parsedTracks.length === 0) {
        return 'completed';
    }

    const state = getTrackStoreState();
    if (!state) {
        return 'completed';
    }

    const newMidiData: Record<string, (typeof parsedTracks)[number]['notes']> = {};

    const tracksWithClips = parsedTracks.map((parsedTrack) => {
        const track = createTrack({ name: parsedTrack.name, kind: 'midi' });
        let maxBeat = 4;
        for (const note of parsedTrack.notes) {
            const value = note.startBeat + note.duration;
            if (value > maxBeat) {
                maxBeat = value;
            }
        }
        const endBeat = Math.ceil(maxBeat / 4) * 4;
        const clip: Clip = {
            id: getNextClipId(),
            trackId: track.id,
            name: parsedTrack.name,
            startBeat: 0,
            endBeat,
            type: 'midi',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
        };
        newMidiData[clip.id] = parsedTrack.notes;
        return { ...track, clips: [clip] };
    });

    const identities = getImportedTrackIdentities(tracksWithClips);
    if (!identities || !canApplyImportedTracks(identities)) {
        notifyUser(`Failed to import "${file.name}" - generated track or clip IDs conflict with the project`, 'error');
        return 'completed';
    }
    if (!shouldContinue()) {
        return 'superseded';
    }

    let midiChange: ReturnType<typeof mergeImportedMidiClipNotes>;
    try {
        midiChange = batchStoreUpdates(() => {
            const change = mergeImportedMidiClipNotes({
                notesByClipId: newMidiData,
            });
            try {
                if (!applyImportedTracks({ tracks: tracksWithClips, identities })) {
                    throw new Error('Imported track or clip IDs conflict with the project');
                }
            } catch (error) {
                try {
                    change.undo();
                } catch {
                    // The MIDI owner already attempted to restore its previous state.
                }
                throw error;
            }

            return change;
        });
    } catch {
        notifyUser(`Failed to import "${file.name}" - project state could not be updated`, 'error');
        return 'completed';
    }

    if (!shouldContinue()) {
        batchStoreUpdates(() => {
            removeImportedTracks(identities);
            midiChange.undo();
        });
        return 'superseded';
    }

    const importedName =
        parsedTracks.length === 1 ? (parsedTracks[0]?.name ?? 'MIDI file') : `${parsedTracks.length} MIDI tracks`;

    pushUndoEntry(
        `Import MIDI: ${importedName}`,
        () => {
            batchStoreUpdates(() => {
                removeImportedTracks(identities);
                try {
                    midiChange.undo();
                } catch (error) {
                    applyImportedTracks({ tracks: tracksWithClips, identities });
                    throw error;
                }
            });
        },
        () => {
            return batchStoreUpdates(() => {
                if (!canApplyImportedTracks(identities)) {
                    notifyUser(
                        `Failed to redo MIDI import for "${file.name}" - track or clip IDs now conflict`,
                        'error'
                    );
                    return REDO_NOT_APPLIED;
                }

                midiChange.redo();
                try {
                    if (!applyImportedTracks({ tracks: tracksWithClips, identities })) {
                        throw new Error('Cannot redo MIDI import because its track or clip IDs now conflict');
                    }
                } catch {
                    try {
                        midiChange.undo();
                    } catch {
                        // The MIDI owner already attempted to restore its previous state.
                    }
                    notifyUser(`Failed to redo MIDI import for "${file.name}"`, 'error');
                    return REDO_NOT_APPLIED;
                }
                return undefined;
            });
        }
    );

    return 'completed';
}
