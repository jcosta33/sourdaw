import { setNotesForClip } from '#/modules/MIDI/useCases';
import { playheadPositionRef, transportStore } from '#/modules/Transport/stores';

import { type MidiNote } from '../../models/MidiNoteViewTypes';
import { getTrackState } from '../../repositories/track/getTrackState';
import { clipboardStore } from '../../stores/clipboardStore';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { addClip } from '../clip/addClip';

export function pasteClip(): boolean {
    const clipClipboard = clipboardStore.value?.clipClipboard ?? [];
    if (clipClipboard.length === 0) {
        return false;
    }

    const transport = transportStore.value;
    const trackState = getTrackState();
    if (!transport || !trackState) {
        return false;
    }

    const playheadBeat = playheadPositionRef.current;
    if (!Number.isFinite(playheadBeat)) {
        return false;
    }

    let minStartBeat = Infinity;
    for (const event of clipClipboard) {
        if (
            event.clip.id.length === 0 ||
            event.clip.trackId !== event.sourceTrackId ||
            !Number.isFinite(event.clip.startBeat) ||
            !Number.isFinite(event.clip.endBeat) ||
            event.clip.startBeat < 0 ||
            event.clip.endBeat <= event.clip.startBeat
        ) {
            return false;
        }
        if (event.clip.startBeat < minStartBeat) {
            minStartBeat = event.clip.startBeat;
        }
    }
    const offset = playheadBeat - minStartBeat;

    const plans: Array<{
        entry: (typeof clipClipboard)[number];
        endBeat: number;
        startBeat: number;
        targetTrackId: string;
    }> = [];
    for (const entry of clipClipboard) {
        const targetTrackId = trackState.selectedTrackId ?? entry.sourceTrackId;
        const targetTrack = trackState.tracks.find((time) => time.id === targetTrackId);
        if (!targetTrack) {
            return false;
        }
        const target = resolveEligibleClipWriteTarget({ trackId: targetTrackId });
        if (target.status !== 'eligible') {
            return false;
        }

        const startBeat = entry.clip.startBeat + offset;
        const endBeat = entry.clip.endBeat + offset;
        if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || startBeat < 0 || endBeat <= startBeat) {
            return false;
        }

        plans.push({ entry, endBeat, startBeat, targetTrackId });
    }

    for (const plan of plans) {
        const { entry, endBeat, startBeat, targetTrackId } = plan;
        const newClip = addClip({
            trackId: targetTrackId,
            startBeat,
            endBeat,
            name: `${entry.clip.name} (paste)`,
            type: entry.clip.type,
            audioBufferId: entry.clip.audioBufferId,
        });

        if (!newClip) {
            return false;
        }

        if (entry.midiNotes && entry.midiNotes.length > 0) {
            const copiedNotes: MidiNote[] = entry.midiNotes.map((node) => ({
                ...node,
                id: `note-${crypto.randomUUID().slice(0, 8)}`,
            }));

            setNotesForClip(newClip.id, copiedNotes);
        }
    }

    return true;
}
