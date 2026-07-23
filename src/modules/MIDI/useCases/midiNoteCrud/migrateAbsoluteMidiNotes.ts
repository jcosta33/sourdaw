import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';

import { midiStore } from '../../stores/midiStore';

/**
 * Data migration for M-01: Converts timeline-absolute stored MIDI notes to clip-relative.
 * AI-generated notes were previously stored as timeline-absolute.
 *
 * Runs on every project load, so it must be idempotent: migrated clip ids
 * are recorded in `migratedAbsoluteNoteClipIds` and skipped on later loads
 * (previously the heuristic re-fired and progressively corrupted clips on
 * every load, M-144).
 */
export function migrateAbsoluteMidiNotes(): void {
    const state = trackStore.value;
    const midiState = midiStore.value;

    if (!state || !midiState) {
        return;
    }

    const alreadyMigrated = new Set(midiState.migratedAbsoluteNoteClipIds ?? []);
    const tracks = state.tracks || [];
    const notesByClipId = { ...midiState.notesByClipId };
    const newlyMigrated: string[] = [];

    for (const track of tracks) {
        for (const clip of track.clips) {
            if (clip.type !== 'midi' || clip.startBeat === 0) {
                continue;
            }
            if (alreadyMigrated.has(clip.id)) {
                continue;
            }

            const notes = notesByClipId[clip.id];
            if (!notes || notes.length === 0) {
                continue;
            }

            const minStart = Math.min(...notes.map((n) => n.startBeat));

            // To prevent false positives on user-drawn notes, we rely on the
            // AI clip naming convention and the fact that AI-generated clips
            // previously always stored their notes >= clip.startBeat.
            const isAiGenerated = /melody|chords|drums|copy/i.test(clip.name);

            if (isAiGenerated && minStart >= clip.startBeat) {
                logger.info(
                    `[migrateAbsoluteMidiNotes] Migrating clip ${clip.id} (${clip.name}) from absolute to relative coordinates.`
                );
                notesByClipId[clip.id] = notes.map((note) => ({
                    ...note,
                    startBeat: note.startBeat - clip.startBeat,
                }));
                newlyMigrated.push(clip.id);
            }
        }
    }

    if (newlyMigrated.length > 0) {
        midiStore.set({
            ...midiState,
            notesByClipId,
            migratedAbsoluteNoteClipIds: [...alreadyMigrated, ...newlyMigrated],
        });
    }
}
