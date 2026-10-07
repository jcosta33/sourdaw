/**
 * In-memory clipboard state for clip and note copy/paste operations.
 */

import { createStore } from '#/infra/store/createStore';
import { type AutomationLane } from '#/modules/Automation/stores';

import { type MidiCC, type MidiNote, type MidiPitchBend } from '../models/MidiNoteViewTypes';
import { type Clip } from '../models/Track';

import { type ClipSatelliteEntry } from './clipSatelliteState';

/**
 * A clip-scoped automation lane captured at copy time: Automation's lane with
 * its owning clip id proven present. Restated here rather than imported from
 * the Arrangement use case that reads lanes, so this store does not depend on
 * a use-case module.
 */
export type ClipClipboardAutomationLane = AutomationLane & { clipId: string };

export type ClipboardEntry = {
    clip: Clip;
    midiNotes?: MidiNote[];
    /**
     * The MIDI controller streams read at copy time — the clip's
     * `ccByClipId` / `pitchBendByClipId` rows, the same records the MIDI
     * store holds under the clip id. Same self-containment rule as the
     * notes: the source clip may be deleted before the paste, and a
     * duplicate carries both streams (`duplicateClipCore`'s MIDI clone), so
     * a paste must too. Absent on entries written before the snapshot
     * carried controller data.
     */
    midiCC?: MidiCC[];
    midiPitchBend?: MidiPitchBend[];
    /**
     * The clip-id-keyed satellite records (gain envelope, warp state) read at
     * copy time, so a paste can rebuild them onto the pasted clip even when the
     * source clip no longer exists. Absent on entries written before the
     * snapshot carried satellites.
     */
    satellites?: ClipSatelliteEntry;
    /**
     * The clip-scoped automation lanes (Automation's store, keyed by clip id)
     * read at copy time — the same self-containment rule as `satellites`: the
     * source clip may be deleted before the paste, and the lanes must ride the
     * snapshot. Paste re-keys clones onto the minted clip id, mirroring
     * `duplicateClipAutomation`.
     */
    automationLanes: readonly ClipClipboardAutomationLane[];
    sourceTrackId: string;
};

export type NoteClipboardEntry = {
    notes: MidiNote[];
};

export type ClipboardState = {
    clipClipboard: ClipboardEntry[];
    noteClipboard: NoteClipboardEntry | null;
};

export const clipboardStore = createStore<ClipboardState>({
    initialData: {
        clipClipboard: [],
        noteClipboard: null,
    },
});

export function setClipClipboard(entries: ClipboardEntry[]): void {
    const current = clipboardStore.value;
    clipboardStore.set({
        clipClipboard: entries,
        noteClipboard: current?.noteClipboard ?? null,
    });
}

export function setNoteClipboard(entry: NoteClipboardEntry | null): void {
    const current = clipboardStore.value;
    clipboardStore.set({
        clipClipboard: current?.clipClipboard ?? [],
        noteClipboard: entry,
    });
}
