import { type TakeLaneStoreState } from '#/modules/Arrangement/stores';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type MidiCC, type MidiNote } from '../../models/MidiNote';
import { SAME_BEAT_TOLERANCE } from '../../models/SameBeatTolerance';
import { type SourceLocatedMidiPitchBend } from '../../services/projectMidiClipWindow';
import {
    frozenMidiTakeRepeatAt,
    frozenMidiTakeRepeats,
    type FrozenMidiTakeFragment,
} from '../../stores/frozenMidiTakeRepeats';
import { isFrozenMidiTakeSource } from '../../stores/isFrozenMidiTakeSource';
import { projectFrozenMidiTakeWindow } from '../../stores/projectFrozenMidiTakeWindow';

import {
    type BaseGapPianoRollNoteOwner,
    type BaseOccurrence,
    type ClipPlacement,
    type QueryWindow,
} from './pianoRollProjectionTypes';
import { projectBaseOccurrences } from './projectBaseOccurrences';
import { projectClipControllerEventsWithProvenance } from './projectClipControllerEventsWithProvenance';
import { projectClipPitchBendEvents } from './projectClipPitchBendEvents';
import { projectMidiClipWindow } from './projectMidiClipWindow';

export type { BaseGapPianoRollNoteOwner } from './pianoRollProjectionTypes';

type OriginalNote = NonNullable<
    TakeLaneStoreState['lanes'][number]['takes'][number]['midiSource']
>['rows']['notes']['value'][number];

function queryBudget(window: QueryWindow) {
    if (
        !Number.isFinite(window.fromBeat) ||
        !Number.isFinite(window.toBeat) ||
        window.toBeat <= window.fromBeat ||
        !Number.isSafeInteger(window.maxWork) ||
        window.maxWork < 1 ||
        !Number.isSafeInteger(window.maxOutput) ||
        window.maxOutput < 1
    ) {
        throw new Error('Invalid MIDI projection query bounds');
    }
    let work = 0;
    let output = 0;
    return {
        charge(amount: number) {
            work += amount;
            if (!Number.isSafeInteger(work) || work > window.maxWork) {
                throw new Error('MIDI projection work budget exceeded');
            }
        },
        emit(amount: number) {
            output += amount;
            if (!Number.isSafeInteger(output) || output > window.maxOutput) {
                throw new Error('MIDI projection output budget exceeded');
            }
        },
    };
}

type QueryBudget = ReturnType<typeof queryBudget>;

function chargeNotes(budget: QueryBudget, notes: readonly MidiNote[]): void {
    budget.charge(notes.length);
    for (const note of notes) {
        budget.charge(
            (note.expression?.pressure?.length ?? 0) +
                (note.expression?.slide?.length ?? 0) +
                (note.expression?.pitchBend?.length ?? 0)
        );
    }
}

export type FrozenPianoRollNoteOwner = {
    readonly laneId: string;
    readonly takeId: string;
    readonly sourceClipId: string;
    readonly sourceEntryBeat: number;
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
    readonly baseNotes: MidiNote[];
    readonly ownersByViewId: ReadonlyMap<string, FrozenPianoRollNoteOwner>;
    readonly baseOwnersByViewId: ReadonlyMap<string, BaseGapPianoRollNoteOwner>;
    readonly baseOccurrences: readonly BaseOccurrence[];
    readonly baseControllers: readonly ReturnType<typeof projectClipControllerEventsWithProvenance>[number][];
    readonly basePitchBends: readonly (ReturnType<typeof projectClipPitchBendEvents>[number] & {
        origin: 'source' | 'carried';
    })[];
    readonly frozenControllers: readonly {
        row: MidiCC;
        origin: 'source' | 'carried' | 'closing' | 'synthetic';
        sourceBeat?: number;
        ownerClipId: string;
        takeId: string;
        occurrenceIndex: number;
    }[];
    readonly frozenPitchBends: readonly {
        row: SourceLocatedMidiPitchBend;
        origin: 'source' | 'carried';
        sourceBeat: number;
        ownerClipId: string;
        takeId: string;
        occurrenceIndex: number;
    }[];
    readonly coveredWindows: readonly { readonly startBeat: number; readonly endBeat: number }[];
    readonly insertOwnerAtBeat: (clipBeat: number) => FrozenPianoRollInsertOwner | null;
    readonly baseSourceBeatAtBeat?: (clipBeat: number) => number | null;
};

type SelectedRegion = {
    readonly laneId: string;
    readonly takeId: string;
    readonly sourceClipId: string;
    readonly startBeat: number;
    readonly endBeat: number;
    /** The comp fragment the take sounds through, as live comp playback resolves it. */
    readonly fragment: FrozenMidiTakeFragment;
    readonly source: NonNullable<TakeLaneStoreState['lanes'][number]['takes'][number]['midiSource']>;
    readonly recordingPassIndex?: number;
};

function selectedRegions(
    clip: ClipPlacement,
    trackId: string,
    laneState: TakeLaneStoreState | null,
    budget?: QueryBudget
): SelectedRegion[] {
    budget?.charge(laneState?.lanes.length ?? 0);
    const lane = laneState?.lanes.find((candidate) => candidate.trackId === trackId);
    if (!lane) {
        return [];
    }
    budget?.charge(lane.activeCompRegions.length * Math.max(1, lane.takes.length));
    return lane.activeCompRegions.flatMap((region) => {
        const take = lane.takes.find((candidate) => candidate.id === region.takeId && candidate.clipId === clip.id);
        if (!take || take.midiSource === undefined) {
            return [];
        }
        if (budget) {
            const rows = take.midiSource.rows;
            budget.charge(rows.notes.value.length + rows.controlChanges.value.length + rows.pitchBends.value.length);
            chargeNotes(budget, rows.notes.value);
        }
        if (!isFrozenMidiTakeSource(take.midiSource)) {
            throw new Error('Invalid frozen MIDI take source');
        }
        const startBeat = Math.max(clip.startBeat, region.startBeat);
        const endBeat = Math.min(clip.endBeat, region.endBeat);
        if (startBeat >= endBeat) {
            return [];
        }
        return [
            {
                laneId: lane.id,
                takeId: take.id,
                sourceClipId: take.midiSource.sourceClipId,
                startBeat,
                endBeat,
                fragment: { startBeat, endBeat, loopEnabled: clip.loopEnabled, loopLength: clip.loopLength },
                source: take.midiSource,
                recordingPassIndex: take.recordingPassIndex,
            },
        ];
    });
}

/** A looping repeat can sound one row twice, its head and its wrapped tail; the tail is a second segment. */
function viewId(
    region: SelectedRegion,
    occurrenceIndex: number,
    regionIndex: number,
    { rowId, segmentIndex }: { rowId: string; segmentIndex: number }
): string {
    const key = [region.laneId, region.takeId, occurrenceIndex, regionIndex, rowId];
    return `frozen:${JSON.stringify(segmentIndex === 0 ? key : [...key, segmentIndex])}`;
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

function chargeFrozenRegion(
    region: ReturnType<typeof selectedRegions>[number],
    fromBeat: number,
    toBeat: number,
    budget: QueryBudget
): void {
    const { source } = region;
    const expansion = projectClipLoopExpansion({
        clipDurationBeats: region.endBeat - region.startBeat,
        configuredLoopLengthBeats: region.fragment.loopLength,
        loopEnabled: region.fragment.loopEnabled ?? false,
    });
    const first = Math.max(0, Math.floor((fromBeat - region.startBeat) / expansion.loopLengthBeats));
    const last = Math.min(expansion.iterationCount, Math.ceil((toBeat - region.startBeat) / expansion.loopLengthBeats));
    const repeats = last - first;
    if (
        !Number.isSafeInteger(first) ||
        !Number.isSafeInteger(last) ||
        repeats < 0 ||
        region.startBeat + first * expansion.loopLengthBeats + expansion.loopLengthBeats <=
            region.startBeat + first * expansion.loopLengthBeats
    ) {
        throw new Error('MIDI projection work budget exceeded');
    }
    const floor = Math.max(
        source.rows.notes.value.reduce((earliest, note) => Math.min(earliest, note.startBeat), Infinity),
        source.readStartBeat ?? -Infinity
    );
    const firstHead = source.phaseHeadBeat + first * expansion.loopLengthBeats;
    if (firstHead + expansion.loopLengthBeats <= firstHead) {
        throw new Error('MIDI projection work budget exceeded');
    }
    let depth = 0;
    if (Number.isFinite(floor) && region.fragment.loopEnabled) {
        depth = Math.max(
            0,
            Math.ceil(
                (Math.min(region.endBeat, region.startBeat + (first + 1) * expansion.loopLengthBeats) -
                    (firstHead - source.sourceEntryBeat) -
                    floor) /
                    expansion.loopLengthBeats
            )
        );
    }
    const finalAnchor = firstHead + (depth + 1) * expansion.loopLengthBeats;
    if (!Number.isFinite(finalAnchor) || finalAnchor + expansion.loopLengthBeats <= finalAnchor) {
        throw new Error('MIDI projection work budget exceeded');
    }
    const curvePoints = source.rows.notes.value.reduce(
        (count, note) =>
            count +
            (note.expression?.pressure?.length ?? 0) +
            (note.expression?.slide?.length ?? 0) +
            (note.expression?.pitchBend?.length ?? 0),
        0
    );
    budget.charge(
        repeats *
            Math.max(1, source.rows.notes.value.length + curvePoints) *
            (depth + source.rows.notes.value.length + 2)
    );
    budget.emit(repeats * source.rows.notes.value.length * (depth + 2));
    const controlCount = source.rows.controlChanges.value.length + source.rows.pitchBends.value.length;
    budget.charge(repeats * controlCount * Math.max(1, controlCount + 3));
    budget.emit(repeats * controlCount * 16);
}

function appendProjectedNotes(
    projected: NonNullable<ReturnType<typeof projectFrozenMidiTakeWindow>>,
    { region, occurrenceIndex, regionIndex }: { region: SelectedRegion; occurrenceIndex: number; regionIndex: number },
    { clip, window }: { clip: ClipPlacement; window: QueryWindow | undefined },
    { notes, ownersByViewId }: { notes: MidiNote[]; ownersByViewId: Map<string, FrozenPianoRollNoteOwner> }
): void {
    const { source } = region;
    const segmentsByRowId = new Map<string, number>();
    for (const note of projected.notes) {
        const original = source.rows.notes.value.find((row) => row.id === note.id);
        if (!original) {
            throw new Error('Frozen MIDI note has no original row');
        }
        const segmentIndex = segmentsByRowId.get(note.id) ?? 0;
        segmentsByRowId.set(note.id, segmentIndex + 1);
        const id = viewId(region, occurrenceIndex, regionIndex, { rowId: note.id, segmentIndex });
        const displayedStartBeat = note.startBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0);
        if (window && (note.startBeat >= window.toBeat || note.startBeat + note.duration <= window.fromBeat)) {
            continue;
        }
        const { recordedOwnBendBeat: _recordedOwnBendBeat, ...displayedNote } = note;
        const display: MidiNote = { ...displayedNote, id, startBeat: displayedStartBeat };
        notes.push(display);
        ownersByViewId.set(id, {
            laneId: region.laneId,
            takeId: region.takeId,
            sourceClipId: region.sourceClipId,
            sourceEntryBeat: source.sourceEntryBeat,
            row: original,
            occurrenceIndex,
            displayedStartBeat,
            displayedDuration: note.duration,
        });
    }
}

function projectRegionOccurrences(
    clip: ClipPlacement,
    {
        region,
        regionIndex,
        fromBeat,
        toBeat,
    }: { region: SelectedRegion; regionIndex: number; fromBeat: number; toBeat: number },
    window: QueryWindow | undefined,
    {
        notes,
        ownersByViewId,
        frozenControllers,
        frozenPitchBends,
    }: {
        notes: MidiNote[];
        ownersByViewId: Map<string, FrozenPianoRollNoteOwner>;
        frozenControllers: Array<PianoRollTakeNotes['frozenControllers'][number]>;
        frozenPitchBends: Array<PianoRollTakeNotes['frozenPitchBends'][number]>;
    }
): void {
    const { source } = region;
    for (const { absoluteOccurrenceIndex: occurrenceIndex } of frozenMidiTakeRepeats(
        source,
        region.fragment,
        fromBeat,
        toBeat
    )) {
        type WindowInput = Parameters<typeof projectFrozenMidiTakeWindow>[0];
        const projectionInput: { -readonly [Key in keyof WindowInput]: WindowInput[Key] } = {
            source,
            fragment: region.fragment,
            recordingPassIndex: region.recordingPassIndex,
            absoluteOccurrenceIndex: occurrenceIndex,
            fromBeat: region.startBeat,
            toBeat: region.endBeat,
        };
        if (window) {
            projectionInput.collectController = (
                entry: Parameters<
                    NonNullable<Parameters<typeof projectFrozenMidiTakeWindow>[0]['collectController']>
                >[0]
            ) => {
                if (
                    entry.row.beat >= window.fromBeat &&
                    (entry.row.beat < window.toBeat || (entry.origin === 'closing' && entry.row.beat === window.toBeat))
                ) {
                    frozenControllers.push({
                        ...entry,
                        ownerClipId: source.sourceClipId,
                        takeId: region.takeId,
                        occurrenceIndex,
                    });
                }
            };
            projectionInput.collectBend = (
                entry: Parameters<NonNullable<Parameters<typeof projectFrozenMidiTakeWindow>[0]['collectBend']>>[0]
            ) => {
                if (entry.row.beat >= window.fromBeat && entry.row.beat < window.toBeat) {
                    frozenPitchBends.push({
                        ...entry,
                        ownerClipId: source.sourceClipId,
                        takeId: region.takeId,
                        occurrenceIndex,
                    });
                }
            };
        }
        const projected = projectFrozenMidiTakeWindow(projectionInput);
        if (!projected) {
            throw new Error('Invalid frozen MIDI take window');
        }
        appendProjectedNotes(
            projected,
            { region, occurrenceIndex, regionIndex },
            { clip, window },
            { notes, ownersByViewId }
        );
    }
}

function projectFrozenRegions(
    clip: ClipPlacement,
    regions: ReturnType<typeof selectedRegions>,
    window: QueryWindow | undefined,
    budget: QueryBudget | undefined
) {
    const notes: MidiNote[] = [];
    const ownersByViewId = new Map<string, FrozenPianoRollNoteOwner>();
    const frozenControllers: Array<PianoRollTakeNotes['frozenControllers'][number]> = [];
    const frozenPitchBends: Array<PianoRollTakeNotes['frozenPitchBends'][number]> = [];
    for (const [regionIndex, region] of regions.entries()) {
        const fromBeat = window ? Math.max(window.fromBeat, region.startBeat) : region.startBeat;
        const toBeat = window ? Math.min(window.toBeat, region.endBeat) : region.endBeat;
        if (fromBeat >= toBeat) {
            continue;
        }
        if (budget) {
            chargeFrozenRegion(region, fromBeat, toBeat, budget);
        }
        projectRegionOccurrences(clip, { region, regionIndex, fromBeat, toBeat }, window, {
            notes,
            ownersByViewId,
            frozenControllers,
            frozenPitchBends,
        });
    }
    return { notes, ownersByViewId, frozenControllers, frozenPitchBends };
}

function projectBaseControllers(
    clip: ClipPlacement,
    coveredWindows: readonly { startBeat: number; endBeat: number }[],
    window: QueryWindow | undefined,
    budget: QueryBudget | undefined
) {
    let baseControllers: PianoRollTakeNotes['baseControllers'] = [];
    let basePitchBends: PianoRollTakeNotes['basePitchBends'] = [];
    if (window && budget) {
        const controllers = window.controlChanges ?? [];
        const bends = window.pitchBends ?? [];
        const sourceCount = controllers.length + bends.length;
        budget.charge(sourceCount);
        const expansion = projectClipLoopExpansion({
            clipDurationBeats: clip.endBeat - clip.startBeat,
            configuredLoopLengthBeats: clip.loopLength,
            loopEnabled: clip.loopEnabled ?? false,
        });
        const passBound = Math.min(
            expansion.iterationCount,
            Math.ceil((window.toBeat - window.fromBeat) / expansion.loopLengthBeats) + 2
        );
        budget.charge(passBound * sourceCount * Math.max(1, sourceCount + 3));
        budget.emit(passBound * sourceCount * 3);
        function uncovered(beat: number): boolean {
            return !coveredWindows.some((region) => beat >= region.startBeat && beat < region.endBeat);
        }
        baseControllers = projectClipControllerEventsWithProvenance({
            controlChanges: controllers,
            clip,
            fromBeat: window.fromBeat,
            toBeat: window.toBeat,
        }).filter((row) => uncovered(row.beat));
        basePitchBends = projectClipPitchBendEvents({
            pitchBends: bends,
            clip,
            fromBeat: window.fromBeat,
            toBeat: window.toBeat,
        })
            .filter((row) => uncovered(row.beat))
            .map((row) => ({
                ...row,
                origin: Math.abs(row.beat - row.recordedBeat) > SAME_BEAT_TOLERANCE ? 'carried' : 'source',
            }));
    }
    return { baseControllers, basePitchBends };
}

export function projectPianoRollTakeNotes(
    clip: ClipPlacement,
    trackId: string,
    laneState: TakeLaneStoreState | null,
    source: readonly MidiNote[] | { baseRows: readonly MidiNote[]; window: QueryWindow } = []
): PianoRollTakeNotes {
    const baseRows = 'window' in source ? source.baseRows : source;
    const window = 'window' in source ? source.window : undefined;
    const budget = window ? queryBudget(window) : undefined;
    if (budget) {
        chargeNotes(budget, baseRows);
    }
    const regions = selectedRegions(clip, trackId, laneState, budget);
    const { notes, ownersByViewId, frozenControllers, frozenPitchBends } = projectFrozenRegions(
        clip,
        regions,
        window,
        budget
    );
    const coveredWindows = regions.map((region) => ({ startBeat: region.startBeat, endBeat: region.endBeat }));
    budget?.charge(baseRows.length * Math.max(1, coveredWindows.length + 1));
    budget?.emit(baseRows.length * Math.max(1, coveredWindows.length + 1));
    const base = projectBaseGapNotes(clip, baseRows, coveredWindows);
    let baseOccurrences: PianoRollTakeNotes['baseOccurrences'] = [];
    if (window && budget) {
        baseOccurrences = projectBaseOccurrences({ clip, baseRows, covered: coveredWindows, base }, window, budget);
    }
    const { baseControllers, basePitchBends } = projectBaseControllers(clip, coveredWindows, window, budget);
    if (window) {
        base.notes = base.notes.filter((note) => {
            const start = clip.startBeat + note.startBeat - (clip.midiOffsetBeats ?? 0);
            return start < window.toBeat && start + note.duration > window.fromBeat;
        });
    }
    return {
        notes,
        baseNotes: base.notes,
        baseOccurrences,
        baseControllers,
        basePitchBends,
        frozenControllers,
        frozenPitchBends,
        ownersByViewId,
        baseOwnersByViewId: base.ownersByViewId,
        coveredWindows,
        baseSourceBeatAtBeat(clipBeat) {
            const arrangementBeat = clip.startBeat + clipBeat - (clip.midiOffsetBeats ?? 0);
            return arrangementBeat >= clip.startBeat &&
                arrangementBeat < clip.endBeat &&
                !coveredWindows.some(
                    (window) => arrangementBeat >= window.startBeat && arrangementBeat < window.endBeat
                )
                ? clipBeat
                : null;
        },
        insertOwnerAtBeat(clipBeat) {
            const arrangementBeat = clip.startBeat + clipBeat - (clip.midiOffsetBeats ?? 0);
            const region = regions.find(
                (candidate) => arrangementBeat >= candidate.startBeat && arrangementBeat < candidate.endBeat
            );
            if (!region) {
                return null;
            }
            const repeat = frozenMidiTakeRepeatAt(region.source, region.fragment, arrangementBeat);
            if (!repeat) {
                return null;
            }
            const sourceBeat = region.source.sourceEntryBeat + arrangementBeat - repeat.passHeadBeat;
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
