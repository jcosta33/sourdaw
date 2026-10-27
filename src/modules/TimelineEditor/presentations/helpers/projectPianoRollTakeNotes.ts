import { type TakeLaneStoreState } from '#/modules/Arrangement/stores';
import { isFrozenMidiTakeSource, projectFrozenMidiTakeWindow } from '#/modules/MIDI/stores';
import { projectMidiClipWindow } from '#/modules/MIDI/useCases';

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

export type BaseGapPianoRollNoteOwner = {
    readonly row: MidiNote;
    readonly displayedStartBeat: number;
    readonly displayedDuration: number;
};

export type PianoRollTakeNotes = {
    readonly notes: MidiNote[];
    readonly baseNotes: MidiNote[];
    readonly ownersByViewId: ReadonlyMap<string, FrozenPianoRollNoteOwner>;
    readonly baseOwnersByViewId: ReadonlyMap<string, BaseGapPianoRollNoteOwner>;
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

function projectBaseGapNotes(
    clip: ClipPlacement,
    baseRows: readonly MidiNote[],
    coveredWindows: readonly { readonly startBeat: number; readonly endBeat: number }[]
): { notes: MidiNote[]; ownersByViewId: Map<string, BaseGapPianoRollNoteOwner> } {
    const ownersByViewId = new Map<string, BaseGapPianoRollNoteOwner>();
    if (coveredWindows.length === 0) {
        return { notes: [...baseRows], ownersByViewId };
    }
    const gaps: Array<{ startBeat: number; endBeat: number }> = [];
    let cursor = clip.startBeat;
    for (const window of [...coveredWindows].sort((a, b) => a.startBeat - b.startBeat)) {
        if (window.startBeat > cursor) {
            gaps.push({ startBeat: cursor, endBeat: Math.min(window.startBeat, clip.endBeat) });
        }
        cursor = Math.max(cursor, window.endBeat);
    }
    if (cursor < clip.endBeat) {
        gaps.push({ startBeat: cursor, endBeat: clip.endBeat });
    }
    const notes: MidiNote[] = [];
    for (const [gapIndex, gap] of gaps.entries()) {
        if (gap.startBeat >= gap.endBeat) {
            continue;
        }
        const sourceStart = gap.startBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0);
        const sourceEnd = gap.endBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0);
        const projected = projectMidiClipWindow({
            notes: baseRows,
            controlChanges: [],
            pitchBends: [],
            window: { beatOffset: 0, visibleStartBeat: sourceStart, visibleEndBeat: sourceEnd },
        });
        for (const note of projected.notes) {
            const original = baseRows.find((row) => row.id === note.id);
            if (!original) {
                throw new Error('Base MIDI gap note has no original row');
            }
            const id = `base-gap:${JSON.stringify([clip.id, gapIndex, note.id])}`;
            notes.push({ ...note, id });
            ownersByViewId.set(id, {
                row: original,
                displayedStartBeat: note.startBeat,
                displayedDuration: note.duration,
            });
        }
    }
    return { notes, ownersByViewId };
}

export function projectPianoRollTakeNotes(
    clip: ClipPlacement,
    trackId: string,
    laneState: TakeLaneStoreState | null,
    baseRows: readonly MidiNote[] = []
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
    const coveredWindows = regions.map((region) => ({ startBeat: region.startBeat, endBeat: region.endBeat }));
    const base = projectBaseGapNotes(clip, baseRows, coveredWindows);
    return {
        notes,
        baseNotes: base.notes,
        ownersByViewId,
        baseOwnersByViewId: base.ownersByViewId,
        coveredWindows,
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
