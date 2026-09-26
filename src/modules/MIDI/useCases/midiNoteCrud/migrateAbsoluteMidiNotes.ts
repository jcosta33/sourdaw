import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';

import { midiStore } from '../../stores/midiStore';

/**
 * Data migration for M-01: Converts timeline-absolute stored MIDI notes to clip-relative.
 * AI-generated notes were previously stored as timeline-absolute.
 *
 * Runs on every project load. Two gates make that safe:
 *
 * - `migratedAbsoluteNoteClipIds` records what already converted, so a reload
 *   of the same document never re-fires (previously the heuristic re-fired and
 *   progressively corrupted clips on every load, M-144).
 * - A clip only qualifies when its stored positions are impossible as
 *   clip-relative data — see the comment at the geometric test below. Current
 *   user data always fits its clip, so a load never rewrites it (#4601), and
 *   the pass is idempotent by construction even where the record was lost (an
 *   arrangement switch, Open Recent, Discard changes all drop it).
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
            const maxStart = Math.max(...notes.map((n) => n.startBeat));

            // Legacy absolute notes for a clip at startBeat P with length L
            // read as positions in [P, P+L); current clip-relative notes read
            // within [0, L). The AI naming convention and the minStart >= P
            // test alone cannot tell those apart — a "Drums" clip at bar 2
            // whose pattern enters late satisfies both either way — so the
            // rewrite additionally requires the relative reading to be
            // impossible: some note at or past the clip's own end, where no
            // clip-relative note can sound. Data that fits its clip is never
            // touched, and a shifted clip lands inside [0, L) and stops
            // qualifying, which keeps the pass idempotent (#4601).
            const isAiGenerated = /melody|chords|drums|copy/i.test(clip.name);
            const clipLength = clip.endBeat - clip.startBeat;
            const impossibleAsClipRelative = maxStart >= clipLength;

            if (isAiGenerated && minStart >= clip.startBeat && impossibleAsClipRelative) {
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
