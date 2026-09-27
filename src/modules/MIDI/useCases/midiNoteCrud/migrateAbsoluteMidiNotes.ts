import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';

import { midiStore } from '../../stores/midiStore';

/**
 * Data migration for M-01: Converts timeline-absolute stored MIDI notes to clip-relative.
 * AI-generated notes were previously stored as timeline-absolute.
 *
 * Runs on every project load. The store's `noteCoordinateFormat` stamp is the
 * primary gate: after any pass the store is written back stamped
 * `'clip-relative'`, and a stamped store returns immediately — current-format
 * data is never rewritten. Fresh stores are born stamped via
 * `defaultMidiStoreState`.
 *
 * Unstamped data — legacy documents, or documents whose stamp was dropped (an
 * arrangement switch, Open Recent, Discard changes drop the whole MIDI
 * snapshot) — still walks the clips under the geometric discriminator: a clip
 * only qualifies when its stored positions are impossible as clip-relative
 * data and still possible as legacy absolute data — see the comment at the
 * geometric test below. Current user data that fits its clip is never
 * rewritten (#4601), and the pass is idempotent by construction even where
 * both the stamp and the migrated-ids record were lost.
 */
export function migrateAbsoluteMidiNotes(): void {
    const state = trackStore.value;
    const midiState = midiStore.value;

    if (!state || !midiState) {
        return;
    }
    if (midiState.noteCoordinateFormat === 'clip-relative') {
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
            // clip-relative note can sound (maxStart >= L). The mirror bound
            // maxStart < P + L rejects the other impossible reading: a clip
            // trimmed shorter than its stored notes (trimClipEnd shortens
            // endBeat without pruning them) holds positions beyond P + L,
            // which no legacy absolute clip could have produced either, so a
            // trim must never turn a reload into a shift (#4827). Data that
            // fits its clip is never touched, and a shifted clip lands inside
            // [0, L) and stops qualifying, which keeps the pass idempotent
            // (#4601).
            const isAiGenerated = /melody|chords|drums|copy/i.test(clip.name);
            const clipLength = clip.endBeat - clip.startBeat;
            const impossibleAsClipRelative = maxStart >= clipLength;
            const stillPossibleAsLegacyAbsolute = maxStart < clip.startBeat + clipLength;

            if (
                isAiGenerated &&
                minStart >= clip.startBeat &&
                impossibleAsClipRelative &&
                stillPossibleAsLegacyAbsolute
            ) {
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

    // Write back even when nothing migrated: stamping the store is what lets
    // every later load skip this pass outright.
    const write: Parameters<typeof midiStore.set>[0] = {
        ...midiState,
        notesByClipId,
        noteCoordinateFormat: 'clip-relative',
    };
    if (newlyMigrated.length > 0) {
        write.migratedAbsoluteNoteClipIds = [...alreadyMigrated, ...newlyMigrated];
    }
    midiStore.set(write);
}
