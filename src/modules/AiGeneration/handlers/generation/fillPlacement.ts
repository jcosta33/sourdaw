import { type Track } from '#/modules/Arrangement/stores';
import {
    addClip,
    addTrackWithDeferredAddedEvent,
    getTrackStoreState,
    selectClipWithFocus,
} from '#/modules/Arrangement/useCases';
import { batchAddMidiNotes, setNotesForClip } from '#/modules/MIDI/useCases';
import {
    type GeneratedMidiStateGuard,
    type HandlerDescribeResult,
    type HandlerExecutionResult,
    type MidiClipNoteSnapshot,
} from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { hasDurableMidiGenerationResult } from '../aiMidi/hasDurableMidiGenerationResult';
import { populateGeneratedMidiStateGuard } from '../aiMidi/populateGeneratedMidiStateGuard';
/**
 * Shared placement machinery for the fill/transition generation handlers
 * (#3765). The pure generators only return note arrays; this module owns the
 * write side: one MIDI clip per dispatch on a resolved drum track, written
 * through `addClip` + `batchAddMidiNotes` so the normal undoable action path,
 * CRDT storage and automation contracts hold.
 *
 * `executeAppAction` calls `describe()` BEFORE `execute()` to capture the undo
 * entry, so the planned clip/track ids and the inverse-action payloads are
 * minted once per action object in a WeakMap and mutated in place by the write
 * — the same pattern `handleGenerateBassline` uses for its async generation.
 * Undo is a guarded discard (`discardDuplicatedClip` /
 * `discardCreatedTrack`) that refuses once the user has edited the material.
 * There is no dedicated redo action: the generators are pure and deterministic,
 * so redo re-executes the original action and this module re-places the exact
 * cached result (conflicting honestly if the material was edited instead).
 */

/** The note shape both fill/transition generators emit, in absolute beats. */
type FillNoteInput = { pitch: number; startBeat: number; duration: number; velocity: number };

export type FillPlacementPlan = {
    clipName: string;
    /** Absolute-beat notes exactly as the generator emitted them. */
    absoluteNotes: ReadonlyArray<FillNoteInput>;
    /** Resolved target MIDI track, or null to create a dedicated track. */
    targetTrack: TrackForPlacement | null;
    /** How many distinct fills went into the clip (for the success message). */
    fillCount: number;
};

export type FillPlacementRefusal = { message: string; level: 'error' | 'warning' };

type TrackForPlacement = Track;

type PlannedFillClip = {
    id: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: 'midi';
};

type FillPlacementState = {
    trackId: string;
    /** Present when the write must create the target track (pre-minted ids keep re-placement deterministic). */
    trackCreationInput: {
        id: string;
        name: string;
        kind: 'midi';
        initialAlternativeId: string;
        initialDeviceId: string;
    } | null;
    clip: PlannedFillClip;
    /** Clip-relative notes derived from the plan's absolute notes. */
    notes: FillNoteInput[];
    resultNotes: MidiClipNoteSnapshot[];
    clipInverse: { clipId: string; generatedMidiStateGuard: GeneratedMidiStateGuard };
    trackInverse: { trackId: string; generatedMidiStateGuard: GeneratedMidiStateGuard };
    fillCount: number;
    materialized: boolean;
};

const fillPlacementStates = new WeakMap<object, FillPlacementState>();

function ensureFillPlacementState(action: object, plan: FillPlacementPlan): FillPlacementState {
    const existing = fillPlacementStates.get(action);
    if (existing) {
        return existing;
    }

    // The generators emit absolute beats; MIDI notes are stored clip-relative
    // and projected back as `clip.startBeat + note.startBeat`, so the span
    // below is exactly the union of the notes' sounding windows.
    const startBeat = Math.min(...plan.absoluteNotes.map((note) => note.startBeat));
    const endBeat = Math.max(...plan.absoluteNotes.map((note) => note.startBeat + note.duration));
    const trackId = plan.targetTrack?.id ?? `track-ai-${crypto.randomUUID()}`;
    let trackCreationInput: FillPlacementState['trackCreationInput'] = null;
    if (!plan.targetTrack) {
        trackCreationInput = {
            id: trackId,
            name: 'Drums',
            kind: 'midi',
            initialAlternativeId: `alt-${crypto.randomUUID()}`,
            initialDeviceId: `dev-synth-${crypto.randomUUID()}`,
        };
    }
    const state: FillPlacementState = {
        trackId,
        trackCreationInput,
        clip: { id: `clip-ai-${crypto.randomUUID()}`, name: plan.clipName, startBeat, endBeat, type: 'midi' },
        notes: plan.absoluteNotes.map((note) => ({
            pitch: note.pitch,
            startBeat: note.startBeat - startBeat,
            duration: note.duration,
            velocity: note.velocity,
        })),
        resultNotes: [],
        clipInverse: { clipId: '', generatedMidiStateGuard: { entityJson: '', midiByClipIdJson: '' } },
        trackInverse: { trackId, generatedMidiStateGuard: { entityJson: '', midiByClipIdJson: '' } },
        fillCount: plan.fillCount,
        materialized: false,
    };
    state.clipInverse.clipId = state.clip.id;
    fillPlacementStates.set(action, state);
    return state;
}

function hasExactPlacement(state: FillPlacementState): boolean {
    return hasDurableMidiGenerationResult({
        trackId: state.trackId,
        clip: state.clip,
        notes: state.resultNotes,
        noteMatch: 'exact',
    });
}

function isPlacementClipPresent(state: FillPlacementState): boolean {
    return getTrackStoreState()?.tracks.some((track) => track.clips.some((clip) => clip.id === state.clip.id)) ?? false;
}

function writePlacementNotes(clipId: string, state: FillPlacementState): void {
    if (state.materialized) {
        // A re-placement after undo must write the exact cached notes (same
        // ids) so the captured guard keeps matching on the next undo.
        setNotesForClip(clipId, structuredClone(state.resultNotes));
        return;
    }
    const writtenNotes = batchAddMidiNotes(clipId, structuredClone(state.notes));
    state.resultNotes.splice(0, state.resultNotes.length, ...writtenNotes);
}

export function describeFillPlacement(input: {
    action: object;
    label: string;
    buildPlan: () => FillPlacementPlan | FillPlacementRefusal;
}): HandlerDescribeResult {
    const plan = input.buildPlan();
    if ('message' in plan) {
        return { label: input.label, inverseAction: null };
    }
    const state = ensureFillPlacementState(input.action, plan);
    let inverseAction: HandlerDescribeResult['inverseAction'];
    if (state.trackCreationInput) {
        inverseAction = { type: 'discardCreatedTrack', payload: state.trackInverse };
    } else {
        inverseAction = { type: 'discardDuplicatedClip', payload: state.clipInverse };
    }
    return { label: input.label, inverseAction };
}

export function executeFillPlacement(input: {
    action: object;
    buildPlan: () => FillPlacementPlan | FillPlacementRefusal;
    successMessage: (placement: {
        trackName: string;
        noteCount: number;
        startBeat: number;
        fillCount: number;
    }) => string;
}): HandlerExecutionResult {
    const plan = input.buildPlan();
    if ('message' in plan) {
        notifyUser(plan.message, plan.level);
        return { status: 'no-write' };
    }
    const state = ensureFillPlacementState(input.action, plan);

    if (state.materialized && hasExactPlacement(state)) {
        return { status: 'no-write' };
    }
    if (state.materialized && isPlacementClipPresent(state)) {
        // The material survived but no longer matches what generation wrote —
        // the user edited it, so re-placing or discarding would clobber that.
        return { status: 'conflict' };
    }

    let trackCreation: ReturnType<typeof addTrackWithDeferredAddedEvent> = null;
    let trackName: string;
    if (state.trackCreationInput) {
        if (getTrackStoreState()?.tracks.some((track) => track.id === state.trackId)) {
            notifyUser('Cannot place the fill: a track with the planned id already exists', 'error');
            return { status: 'no-write' };
        }
        trackCreation = addTrackWithDeferredAddedEvent(state.trackCreationInput);
        if (!trackCreation) {
            notifyUser('Cannot place the fill: track creation failed', 'error');
            return { status: 'no-write' };
        }
        trackName = trackCreation.track.name;
    } else {
        const target = getTrackStoreState()?.tracks.find((track) => track.id === state.trackId);
        if (!target || target.kind !== 'midi') {
            notifyUser('Cannot place the fill: the resolved drum track is no longer available', 'error');
            return { status: 'no-write' };
        }
        trackName = target.name;
    }

    const placedClip = addClip({
        id: state.clip.id,
        trackId: state.trackId,
        startBeat: state.clip.startBeat,
        endBeat: state.clip.endBeat,
        name: state.clip.name,
        type: 'midi',
    });
    if (!placedClip) {
        notifyUser('Cannot place the fill: clip creation failed', 'error');
        return { status: 'no-write' };
    }

    writePlacementNotes(placedClip.id, state);

    if (state.trackCreationInput) {
        const guardedTrack = getTrackStoreState()?.tracks.find((track) => track.id === state.trackId);
        populateGeneratedMidiStateGuard({
            guard: state.trackInverse.generatedMidiStateGuard,
            entity: guardedTrack ?? { ...trackCreation!.track, clips: [placedClip] },
            clipIds: [placedClip.id],
        });
    } else {
        populateGeneratedMidiStateGuard({
            guard: state.clipInverse.generatedMidiStateGuard,
            entity: placedClip,
            clipIds: [placedClip.id],
        });
    }
    state.materialized = true;

    selectClipWithFocus(placedClip.id);
    notifyUser(
        input.successMessage({
            trackName,
            noteCount: state.resultNotes.length,
            startBeat: placedClip.startBeat,
            fillCount: state.fillCount,
        }),
        'success'
    );

    if (!trackCreation) {
        return { status: 'written' };
    }
    const createdTrack = trackCreation;
    return {
        status: 'written',
        afterCommit: () => void createdTrack.afterCommit(),
        afterAmbiguousCommit: () => createdTrack.afterAmbiguousCommit(),
    };
}
