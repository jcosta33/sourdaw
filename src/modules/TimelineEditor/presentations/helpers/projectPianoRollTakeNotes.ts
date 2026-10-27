import { type TakeLaneStoreState } from '#/modules/Arrangement/stores';
import { isFrozenMidiTakeSource, projectFrozenMidiTakeWindow } from '#/modules/MIDI/stores';

import { type MidiNote } from '../../models/MidiNoteViewTypes';

type OriginalNote = NonNullable<
    TakeLaneStoreState['lanes'][number]['takes'][number]['midiSource']
>['rows']['notes']['value'][number];

type ClipPlacement = {
    readonly id: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly midiOffsetBeats?: number;
};

export type FrozenPianoRollNoteOwner = {
    readonly laneId: string;
    readonly takeId: string;
    readonly sourceClipId: string;
    readonly row: OriginalNote;
    readonly occurrenceIndex: number;
    readonly displayedStartBeat: number;
    readonly displayedDuration: number;
};

export type FrozenPianoRollInsertOwner = {
    readonly laneId: string;
    readonly takeId: string;
    readonly sourceClipId: string;
    readonly sourceBeat: number;
    readonly recordingPassIndex?: number;
    readonly slotPresent: boolean;
};

export type PianoRollTakeNotes = {
    readonly notes: MidiNote[];
    readonly ownersByViewId: ReadonlyMap<string, FrozenPianoRollNoteOwner>;
    readonly coveredWindows: readonly { readonly startBeat: number; readonly endBeat: number }[];
    readonly insertOwnerAtBeat: (clipBeat: number) => FrozenPianoRollInsertOwner | null;
};

type SelectedRegion = {
    readonly laneId: string;
    readonly takeId: string;
    readonly sourceClipId: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly source: NonNullable<TakeLaneStoreState['lanes'][number]['takes'][number]['midiSource']>;
    readonly recordingPassIndex?: number;
};

function selectedRegions(clip: ClipPlacement, trackId: string, laneState: TakeLaneStoreState | null): SelectedRegion[] {
    const lane = laneState?.lanes.find((candidate) => candidate.trackId === trackId);
    if (!lane) {
        return [];
    }
    return lane.activeCompRegions.flatMap((region) => {
        const take = lane.takes.find((candidate) => candidate.id === region.takeId && candidate.clipId === clip.id);
        if (!take || take.midiSource === undefined) {
            return [];
        }
        if (!isFrozenMidiTakeSource(take.midiSource)) {
            throw new Error('Invalid frozen MIDI take source');
        }
        const startBeat = Math.max(clip.startBeat, region.startBeat);
        const endBeat = Math.min(clip.endBeat, region.endBeat);
        return startBeat < endBeat
            ? [
                  {
                      laneId: lane.id,
                      takeId: take.id,
                      sourceClipId: take.midiSource.sourceClipId,
                      startBeat,
                      endBeat,
                      source: take.midiSource,
                      recordingPassIndex: take.recordingPassIndex,
                  },
              ]
            : [];
    });
}

function viewId(region: SelectedRegion, occurrenceIndex: number, regionIndex: number, rowId: string): string {
    return `frozen:${JSON.stringify([region.laneId, region.takeId, occurrenceIndex, regionIndex, rowId])}`;
}

export function projectPianoRollTakeNotes(
    clip: ClipPlacement,
    trackId: string,
    laneState: TakeLaneStoreState | null
): PianoRollTakeNotes {
    const regions = selectedRegions(clip, trackId, laneState);
    const notes: MidiNote[] = [];
    const ownersByViewId = new Map<string, FrozenPianoRollNoteOwner>();
    for (const [regionIndex, region] of regions.entries()) {
        const { source } = region;
        const span = source.sourceEndBeat - source.sourceEntryBeat;
        const first = Math.max(
            0,
            Math.floor((region.startBeat - source.phaseHeadBeat - span) / source.passLengthBeats) + 1
        );
        const last = Math.ceil((region.endBeat - source.phaseHeadBeat) / source.passLengthBeats);
        for (let occurrenceIndex = first; occurrenceIndex < last; occurrenceIndex++) {
            const projected = projectFrozenMidiTakeWindow({
                source,
                recordingPassIndex: region.recordingPassIndex,
                absoluteOccurrenceIndex: occurrenceIndex,
                fromBeat: region.startBeat,
                toBeat: region.endBeat,
            });
            if (!projected) {
                throw new Error('Invalid frozen MIDI take window');
            }
            for (const note of projected.notes) {
                const original = source.rows.notes.value.find((row) => row.id === note.id);
                if (!original) {
                    throw new Error('Frozen MIDI note has no original row');
                }
                const id = viewId(region, occurrenceIndex, regionIndex, note.id);
                const displayedStartBeat = note.startBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0);
                const display: MidiNote = { ...note, id, startBeat: displayedStartBeat };
                notes.push(display);
                ownersByViewId.set(id, {
                    laneId: region.laneId,
                    takeId: region.takeId,
                    sourceClipId: region.sourceClipId,
                    row: original,
                    occurrenceIndex,
                    displayedStartBeat,
                    displayedDuration: note.duration,
                });
            }
        }
    }
    return {
        notes,
        ownersByViewId,
        coveredWindows: regions.map((region) => ({ startBeat: region.startBeat, endBeat: region.endBeat })),
        insertOwnerAtBeat(clipBeat) {
            const arrangementBeat = clip.startBeat + clipBeat - (clip.midiOffsetBeats ?? 0);
            const region = regions.find(
                (candidate) => arrangementBeat >= candidate.startBeat && arrangementBeat < candidate.endBeat
            );
            if (!region) {
                return null;
            }
            const occurrenceIndex = Math.floor(
                (arrangementBeat - region.source.phaseHeadBeat) / region.source.passLengthBeats
            );
            const passHeadBeat = region.source.phaseHeadBeat + occurrenceIndex * region.source.passLengthBeats;
            const sourceBeat = region.source.sourceEntryBeat + arrangementBeat - passHeadBeat;
            if (
                occurrenceIndex < 0 ||
                sourceBeat < region.source.sourceEntryBeat ||
                sourceBeat >= region.source.sourceEndBeat
            ) {
                return null;
            }
            return {
                laneId: region.laneId,
                takeId: region.takeId,
                sourceClipId: region.sourceClipId,
                sourceBeat,
                recordingPassIndex: region.recordingPassIndex,
                slotPresent: region.source.rows.notes.present,
            };
        },
    };
}
