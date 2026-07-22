import { setNotesForClip } from '#/modules/MIDI/useCases';
import { playheadPositionRef, transportStore } from '#/modules/Transport/stores';

import { type MidiNote } from '../../models/MidiNoteViewTypes';
import { getTrackState } from '../../repositories/track/getTrackState';
import { clipboardStore } from '../../stores/clipboardStore';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { addClip } from '../clip/addClip';
import { removeClip } from '../clip/removeClip';

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
    const sourceClipIds = new Set<string>();
    for (const event of clipClipboard) {
        const eventValue: unknown = event;
        if (typeof eventValue !== 'object' || eventValue === null) {
            return false;
        }
        const sourceClipValue: unknown = Reflect.get(eventValue, 'clip');
        if (typeof sourceClipValue !== 'object' || sourceClipValue === null) {
            return false;
        }

        const sourceClipId: unknown = Reflect.get(sourceClipValue, 'id');
        const clipOwnerId: unknown = Reflect.get(sourceClipValue, 'trackId');
        const sourceTrackId: unknown = Reflect.get(eventValue, 'sourceTrackId');
        if (typeof sourceClipId !== 'string' || sourceClipId.length === 0) {
            return false;
        }
        if (typeof clipOwnerId !== 'string' || clipOwnerId.length === 0) {
            return false;
        }
        if (typeof sourceTrackId !== 'string' || sourceTrackId.length === 0) {
            return false;
        }
        if (clipOwnerId !== sourceTrackId || sourceClipIds.has(sourceClipId)) {
            return false;
        }
        sourceClipIds.add(sourceClipId);

        const sourceClip = event.clip;
        if (
            !Number.isFinite(sourceClip.startBeat) ||
            !Number.isFinite(sourceClip.endBeat) ||
            sourceClip.startBeat < 0 ||
            sourceClip.endBeat <= sourceClip.startBeat
        ) {
            return false;
        }
        if (sourceClip.startBeat < minStartBeat) {
            minStartBeat = sourceClip.startBeat;
        }
    }

    for (const entry of clipClipboard) {
        const sourceTarget = resolveEligibleClipWriteTarget({ trackId: entry.sourceTrackId });
        if (sourceTarget.status !== 'eligible') {
            return false;
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

    const addedClipIds: string[] = [];
    let pasteCompleted = true;
    try {
        for (const plan of plans) {
            const { entry, endBeat, startBeat, targetTrackId } = plan;
            const newClip = addClip({
                trackId: targetTrackId,
                startBeat,
                endBeat,
                name: `${entry.clip.name} (paste)`,
                type: entry.clip.type,
                audioBufferId: entry.clip.audioBufferId,
                midiOffsetBeats: entry.clip.midiOffsetBeats,
            });

            if (!newClip) {
                pasteCompleted = false;
                break;
            }
            addedClipIds.push(newClip.id);

            if (entry.midiNotes && entry.midiNotes.length > 0) {
                const copiedNotes: MidiNote[] = entry.midiNotes.map((node) => ({
                    ...node,
                    id: `note-${crypto.randomUUID().slice(0, 8)}`,
                }));

                setNotesForClip(newClip.id, copiedNotes);
            }
        }
    } catch {
        pasteCompleted = false;
    }

    if (pasteCompleted) {
        return true;
    }

    while (addedClipIds.length > 0) {
        const addedClipId = addedClipIds.pop();
        if (addedClipId === undefined) {
            break;
        }
        removeClip(addedClipId);
    }

    return false;
}
