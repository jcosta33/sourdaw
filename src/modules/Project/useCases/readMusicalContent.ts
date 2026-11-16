import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { chordTrackStore, midiStore } from '#/modules/MIDI/stores';
import { projectPianoRollTakeNotes, readPianoRollSelection } from '#/modules/MIDI/useCases';

import { type SemanticProjectQueryInput, type SemanticQueryItem } from '../models/SemanticProjectQuery';
import { projectStore } from '../stores/projectStore';

/** Stored musical rows and their ownership, not a prediction of the processed sound. */
export function readMusicalContent(input: SemanticProjectQueryInput): SemanticQueryItem[] {
    const { stableId, startBeat, endBeat } = input.filters ?? {};
    if (stableId === undefined || startBeat === undefined || endBeat === undefined || endBeat <= startBeat) {
        throw new Error('Musical content requires one clip and a nonempty range');
    }
    const selection = readPianoRollSelection();
    if (selection.token !== input.selectionToken) {
        throw new Error('Stale musical selection');
    }
    const targetIsOpen = selection.clipIds.includes(stableId);
    if (targetIsOpen && selection.status === 'ambiguous') {
        throw new Error('Ambiguous piano roll selection');
    }
    if (targetIsOpen && selection.status === 'unavailable' && selection.viewIds.length > 0) {
        throw new Error('Piano roll selection unavailable');
    }
    const track = trackStore.value?.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === stableId));
    const clip = track?.clips.find((candidate) => candidate.id === stableId);
    if (!track || !clip || clip.type !== 'midi') throw new Error('MIDI clip not found');
    const midi = midiStore.value;
    if (!midi) throw new Error('MIDI content unavailable');
    const projection = projectPianoRollTakeNotes(
        clip,
        track.id,
        takeLaneStore.value,
        midi.notesByClipId[clip.id] ?? [],
        {
            fromBeat: startBeat,
            toBeat: endBeat,
            maxWork: 16_384,
            maxOutput: 512,
            controlChanges: midi.ccByClipId[clip.id] ?? [],
            pitchBends: midi.pitchBendByClipId[clip.id] ?? [],
        }
    );
    const rows: SemanticQueryItem[] = [];
    const addRow = (row: SemanticQueryItem): void => {
        if (rows.length >= 512) throw new Error('Musical content row budget exceeded');
        if (Object.values(row).some((value) => typeof value === 'string' && value.length > 2_048)) {
            throw new Error('Musical content text exceeds receipt limit');
        }
        rows.push(row);
    };
    addRow({
        id: clip.id,
        kind: 'musical-window',
        startBeat,
        endBeat,
        clipStartBeat: clip.startBeat,
        clipEndBeat: clip.endBeat,
        midiOffsetBeats: clip.midiOffsetBeats ?? 0,
        loopEnabled: clip.loopEnabled ?? false,
        loopLength: clip.loopLength ?? null,
        parentClipId: clip.parentClipId ?? null,
        keyRoot: projectStore.value?.keyRoot ?? null,
        scaleName: projectStore.value?.scaleName ?? null,
        keyProvenance: projectStore.value ? 'project-settings' : 'unknown',
        controllerChase: 'unavailable',
        noteSelection: targetIsOpen && selection.status === 'resolved' ? 'available' : 'unavailable',
    });
    type SourceNote = NonNullable<typeof midi>['notesByClipId'][string][number];
    const addNote = (
        original: SourceNote,
        viewId: string,
        ownerClipId: string,
        timelineStart: number,
        timelineDuration: number,
        projectedVelocity: number,
        takeId: string | null,
        occurrenceIndex: number
    ): void => {
        addRow({
            id: JSON.stringify([ownerClipId, takeId, occurrenceIndex, viewId, timelineStart, timelineDuration]),
            kind: 'note',
            noteId: original.id,
            ownerClipId,
            clipId: clip.id,
            pitch: original.pitch,
            startBeat: original.startBeat,
            duration: original.duration,
            velocity: original.velocity,
            channel: original.channel ?? null,
            probability: original.probability ?? null,
            articulation: original.articulation ?? null,
            pressure: original.pressure ?? null,
            slide: original.slide ?? null,
            pitchBend: original.pitchBend ?? null,
            pitchBendRangeSemitones: original.pitchBendRangeSemitones ?? null,
            selected: selection.owners.some(
                (owner) =>
                    owner.clipId === clip.id &&
                    owner.viewId === viewId &&
                    owner.ownerClipId === ownerClipId &&
                    owner.storedNoteId === original.id
            ),
            viewId,
            timelineStartBeat: timelineStart,
            timelineDuration,
            projectedVelocity,
            takeId,
            occurrenceIndex,
            sourceBasis: 'stored-score',
            projectionBasis: 'clip-projection',
        });
        for (const dimension of ['pressure', 'slide', 'pitchBend'] as const) {
            for (const [index, point] of (original.expression?.[dimension] ?? []).entries()) {
                addRow({
                    id: JSON.stringify([ownerClipId, takeId, occurrenceIndex, viewId, dimension, index]),
                    kind: 'expression',
                    ownerClipId,
                    noteId: original.id,
                    dimension,
                    offsetBeats: point.offsetBeats,
                    value: point.value,
                });
            }
        }
    };
    for (const occurrence of projection.baseOccurrences) {
        addNote(
            occurrence.row,
            occurrence.viewId,
            clip.id,
            occurrence.startBeat,
            occurrence.duration,
            occurrence.velocity,
            null,
            occurrence.occurrenceIndex
        );
    }
    for (const displayed of projection.notes) {
        const frozen = projection.ownersByViewId.get(displayed.id);
        if (!frozen) throw new Error('Frozen MIDI note owner unavailable');
        const timelineStart = clip.startBeat + displayed.startBeat - (clip.midiOffsetBeats ?? 0);
        addNote(
            frozen.row,
            displayed.id,
            frozen.sourceClipId,
            timelineStart,
            displayed.duration,
            displayed.velocity,
            frozen.takeId,
            frozen.occurrenceIndex
        );
    }
    for (const [index, controller] of projection.baseControllers.entries()) {
        addRow({
            id: JSON.stringify([clip.id, 'controller', index, controller.id]),
            kind: 'controller',
            ownerClipId: clip.id,
            sourceId: controller.id,
            sourceBeat: controller.sourceBeat,
            timelineBeat: controller.beat,
            controller: controller.controller,
            value: controller.value,
            channel: controller.channel,
            origin: controller.origin,
        });
    }
    for (const [index, bend] of projection.basePitchBends.entries()) {
        addRow({
            id: JSON.stringify([clip.id, 'pitch-bend', index, bend.id]),
            kind: 'pitch-bend',
            ownerClipId: clip.id,
            sourceId: bend.id,
            sourceBeat: bend.recordedContentBeat,
            timelineBeat: bend.beat,
            value: bend.value,
            channel: bend.channel,
            channelScoped: bend.channelScoped ?? null,
            origin: bend.origin,
        });
    }
    for (const [index, event] of projection.frozenControllers.entries()) {
        addRow({
            id: JSON.stringify([
                event.ownerClipId,
                event.takeId,
                event.occurrenceIndex,
                'controller',
                index,
                event.row.id,
            ]),
            kind: 'controller',
            ownerClipId: event.ownerClipId,
            takeId: event.takeId,
            occurrenceIndex: event.occurrenceIndex,
            sourceId: event.origin === 'synthetic' ? null : event.row.id,
            sourceBeat: event.sourceBeat ?? null,
            timelineBeat: event.row.beat,
            controller: event.row.controller,
            value: event.row.value,
            channel: event.row.channel,
            origin: event.origin,
        });
    }
    for (const [index, event] of projection.frozenPitchBends.entries()) {
        addRow({
            id: JSON.stringify([
                event.ownerClipId,
                event.takeId,
                event.occurrenceIndex,
                'pitch-bend',
                index,
                event.row.id,
            ]),
            kind: 'pitch-bend',
            ownerClipId: event.ownerClipId,
            takeId: event.takeId,
            occurrenceIndex: event.occurrenceIndex,
            sourceId: event.row.id,
            sourceBeat: event.sourceBeat,
            timelineBeat: event.row.beat,
            value: event.row.value,
            channel: event.row.channel,
            channelScoped: event.row.channelScoped ?? null,
            origin: event.origin,
        });
    }
    const chords = chordTrackStore.value?.events ?? [];
    if (chords.length > 16_384) throw new Error('Musical content chord budget exceeded');
    let hasHarmony = false;
    for (const chord of chords) {
        if (chord.beat >= endBeat || chord.beat + chord.duration <= startBeat) continue;
        hasHarmony = true;
        addRow({
            id: chord.id,
            kind: 'harmony',
            beat: chord.beat,
            duration: chord.duration,
            root: chord.root,
            quality: chord.quality,
            enabled: chordTrackStore.value?.enabled ?? false,
            provenance: 'chord-track',
        });
    }
    if (!hasHarmony) addRow({ id: 'harmony-unknown', kind: 'harmony', provenance: 'unknown' });
    return rows;
}
