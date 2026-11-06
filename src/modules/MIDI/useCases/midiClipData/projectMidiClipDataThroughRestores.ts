import { type AppAction, type MidiCcSnapshot, type MidiPitchBendSnapshot } from '#/utils/handlerContract';

import { type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNote';
import { decodeMidiClipDataSnapshots } from '../../services/decodeMidiClipDataSnapshots';
import { midiStore } from '../../stores/midiStore';
import { projectMidiNotesByClipIdThroughRestores } from '../midiNoteTransforms/projectMidiNotesByClipIdThroughRestores';

export type ProjectedMidiClipData = {
    readonly notesByClipId: Record<string, MidiNote[]>;
    readonly ccByClipId: Record<string, MidiCC[]>;
    readonly pitchBendByClipId: Record<string, MidiPitchBend[]>;
};

type ControllerRestore = {
    readonly clipId: string;
    readonly controlChangeSnapshot: MidiCcSnapshot | null;
    readonly pitchBendSnapshot: MidiPitchBendSnapshot | null;
};

/** The controller buckets an inverse replays through `restoreMidiClipData`, per clip. */
function controllerRestoresOf(action: AppAction): ControllerRestore[] {
    if (action.type === 'restoreClip') {
        return [
            {
                clipId: action.payload.clipId,
                controlChangeSnapshot: action.payload.midiCcSnapshot,
                pitchBendSnapshot: action.payload.midiPitchBendSnapshot,
            },
        ];
    }
    if (action.type === 'restoreTrack') {
        const { midiCcByClipId, midiPitchBendByClipId } = action.payload;
        const clipIds = new Set([...Object.keys(midiCcByClipId), ...Object.keys(midiPitchBendByClipId)]);
        return Array.from(clipIds, (clipId) => ({
            clipId,
            controlChangeSnapshot: midiCcByClipId[clipId] ?? null,
            pitchBendSnapshot: midiPitchBendByClipId[clipId] ?? null,
        }));
    }
    return [];
}

/**
 * The MIDI buckets the earlier members of a batch leave behind, without
 * changing project state, so a grouped-undo preflight can judge a member
 * against what its predecessors restore rather than against the live store.
 * `restoreMidiClipData` replaces each bucket a restore carries and leaves a
 * `null` one alone, and the projection follows the same rule. A snapshot the
 * decoder refuses is skipped: `restoreMidiClipData` throws on it, so the batch
 * fails before the member being judged runs.
 */
export function projectMidiClipDataThroughRestores(actions: readonly AppAction[]): ProjectedMidiClipData {
    const restoredCcByClipId: Record<string, MidiCC[]> = {};
    const restoredPitchBendByClipId: Record<string, MidiPitchBend[]> = {};
    for (const restore of actions.flatMap(controllerRestoresOf)) {
        const decoded = decodeMidiClipDataSnapshots({
            notesSnapshot: null,
            controlChangeSnapshot: restore.controlChangeSnapshot,
            pitchBendSnapshot: restore.pitchBendSnapshot,
        });
        if (!decoded) {
            continue;
        }
        if (decoded.controlChangeSnapshot !== null) {
            restoredCcByClipId[restore.clipId] = decoded.controlChangeSnapshot;
        }
        if (decoded.pitchBendSnapshot !== null) {
            restoredPitchBendByClipId[restore.clipId] = decoded.pitchBendSnapshot;
        }
    }
    return {
        notesByClipId: projectMidiNotesByClipIdThroughRestores(actions),
        ccByClipId: { ...midiStore.value?.ccByClipId, ...restoredCcByClipId },
        pitchBendByClipId: { ...midiStore.value?.pitchBendByClipId, ...restoredPitchBendByClipId },
    };
}
