import { trackStore } from '#/modules/Arrangement/stores';
import { logger } from '#/infra/logger/appLogger';

import { midiStore } from '../../stores/midiStore';

/**
 * Data migration for M-01: Converts timeline-absolute stored MIDI notes to clip-relative.
 * AI-generated notes were previously stored as timeline-absolute.
 */
export function migrateAbsoluteMidiNotes(): void {
    const state = trackStore.value;
    const midiState = midiStore.value;

    if (!state || !midiState) return;

    const tracks = state.tracks || [];
    const notesByClipId = { ...midiState.notesByClipId };
    let migrated = false;

    for (const track of tracks) {
        for (const clip of track.clips) {
            if (clip.type !== 'midi' || clip.startBeat === 0) continue;

            const notes = notesByClipId[clip.id];
            if (!notes || notes.length === 0) continue;

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
                migrated = true;
            }
        }
    }

    if (migrated) {
        midiStore.set({ ...midiState, notesByClipId });
    }
}
