import { activeRecordingRef, trackStore, takeLaneStore } from '#/modules/Arrangement/stores';
import { getAudioContext } from '#/modules/AudioEngine/useCases';
import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';
import { grooveTemplateStore, midiStore } from '#/modules/MIDI/stores';
import { readYeastRack } from '#/modules/Yeast/stores';
import { valuesEqual } from '#/utils/structuralEquality';

import { getTempoAtBeat } from '../../models/TempoMap';
import { getTransportState } from '../../repositories/transport/getTransportState';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { prepareInitialMidiWindow } from '../scheduling/prepareInitialMidiWindow';

import { INITIAL_HIGH_WATER_OFFSET_BEATS, projectLoopSeamWindow } from './projectLoopSeamWindow';
import { schedulerLookAheadBeats } from './schedulerLookAheadBeats';
import { schedulerSession } from './schedulerSession';

import type { SchedulerCancellation } from '../scheduling/schedulerCancellation';

const PROGRAMME_FIELDS = [
    'playheadPosition',
    'tempo',
    'isLooping',
    'loopStart',
    'loopEnd',
    'timeSignatureNumerator',
    'timeSignatureDenominator',
    'metronomeEnabled',
    'metronomeVolume',
    'punchInEnabled',
    'punchInBeat',
    'punchOutBeat',
    'scheduleGrainMs',
] as const;

type TrackState = typeof trackStore.value;

function hasYeast(track: NonNullable<TrackState>['tracks'][number]) {
    return track.kind === 'midi' && track.devices.some((device) => device.type === 'yeast');
}

/**
 * The tracks the prepared programme reads. A Yeast track is prepared off the
 * snapshot, then re-resolved live at emission and paired with the prepared
 * notes by track id. A track this emission records on holds the provisional
 * clip and take its pending admission records into. Bus ids decide which muted
 * tracks still prepare. Every other track is read only live, in the emission
 * turn, so an edit there during preparation is what the roll plays (#6012).
 */
function projectPreparedTracks(trackState: TrackState, recordingClipIds: ReadonlySet<string>) {
    const tracks = trackState?.tracks ?? [];
    return {
        busIds: tracks.filter((track) => track.kind === 'bus').map((track) => track.id),
        tracks: tracks.filter((track) => hasYeast(track) || track.clips.some((clip) => recordingClipIds.has(clip.id))),
    };
}

/**
 * Whether a store still projects to the inputs it held at capture. A store write
 * rebuilds every track from the document, so unchanged inputs are compared by
 * value; the projection is recomputed only when the store value moves.
 */
function witnessProjection<State, Projection>(read: () => State, project: (state: State) => Projection) {
    let checked = read();
    const captured = project(checked);
    let current = true;
    return () => {
        const state = read();
        if (state !== checked) {
            checked = state;
            current = valuesEqual(project(state), captured);
        }
        return current;
    };
}

/** A source witness captured before any external readiness wait. */
function captureInitialMidiProgramme(cancellation: SchedulerCancellation) {
    const trackState = trackStore.value;
    const midiState = midiStore.value;
    const grooveState = grooveTemplateStore.value;
    const tempoState = tempoMapStore.value;
    const meterState = timeSignatureMapStore.value;
    const recordingClipIds = new Set(activeRecordingRef.current);
    const prepared = projectPreparedTracks(trackState, recordingClipIds);
    const preparedTrackIds = new Set(prepared.tracks.map((track) => track.id));
    const yeastClipIds = prepared.tracks.filter(hasYeast).flatMap((track) => track.clips.map((clip) => clip.id));
    const racks = (trackState?.tracks ?? []).flatMap((track) =>
        track.devices
            .filter((device) => device.type === 'yeast')
            .map((device) => ({ id: device.id, processors: structuredClone(readYeastRack(device.id).processors) }))
    );
    const tracksCurrent = witnessProjection(
        () => trackStore.value,
        (state) => projectPreparedTracks(state, recordingClipIds)
    );
    const lanesCurrent = witnessProjection(
        () => takeLaneStore.value,
        (state) => state?.lanes.filter((lane) => preparedTrackIds.has(lane.trackId))
    );
    const notesCurrent = witnessProjection(
        () => midiStore.value,
        (state) => state && [state.probabilitySeed, yeastClipIds.map((clipId) => state.notesByClipId[clipId])]
    );
    const isCurrent = () =>
        cancellation.isCurrent() &&
        racks.every((rack) => valuesEqual(readYeastRack(rack.id).processors, rack.processors)) &&
        tracksCurrent() &&
        lanesCurrent() &&
        notesCurrent() &&
        grooveTemplateStore.value === grooveState &&
        tempoMapStore.value === tempoState &&
        timeSignatureMapStore.value === meterState;
    return { trackState, midiState, tempoState, isCurrent };
}

/** Capture the requested programme before scheduler-owned recording preparation. */
export function prepareInitialBrowserPlayback(generation: number) {
    const state = getTransportState();
    if (!state?.isPlaying) {
        return null;
    }
    const root = captureProjectRootIdentity();
    const tempoState = tempoMapStore.value;
    const changes = tempoState?.changes ?? [];
    const epoch = schedulerSession.discontinuityEpoch;
    const position = state.playheadPosition;
    const lookAheadBeats = schedulerLookAheadBeats(getTempoAtBeat(changes, position, state.tempo));
    const seam = projectLoopSeamWindow(
        state,
        changes,
        position,
        position,
        lookAheadBeats,
        getAudioContext().currentTime
    );
    const ownsSession = () =>
        schedulerSession.generation === generation &&
        captureProjectRootIdentity() === root &&
        getTransportState()?.isPlaying === true;
    const isCurrent = () => {
        const current = getTransportState();
        return (
            ownsSession() &&
            current !== null &&
            PROGRAMME_FIELDS.every((field) => current[field] === state[field]) &&
            tempoMapStore.value === tempoState
        );
    };
    const cancellation: SchedulerCancellation = {
        generation,
        get discontinuityEpoch() {
            return schedulerSession.discontinuityEpoch;
        },
        isCurrent,
        yeastRouteLineage: new Map(),
    };
    const from = position - INITIAL_HIGH_WATER_OFFSET_BEATS;
    let windows = [{ from, to: position + lookAheadBeats }];
    if (seam) {
        windows = [
            { from, to: state.loopEnd },
            { from: state.loopStart, to: seam.wrappedUpTo },
        ];
    }
    const originalProgramme = captureInitialMidiProgramme(cancellation);
    // Called immediately after the scheduler's synchronous recording writes.
    // Its new witness includes those clips and takes, and still rejects any
    // edit to a prepared input arriving while audio admission or Yeast
    // readiness is pending.
    function prepareMidiWindows() {
        const programme = captureInitialMidiProgramme(cancellation);
        return prepareWindows(programme);
    }
    async function prepareWindows(programme: ReturnType<typeof captureInitialMidiProgramme>) {
        const current = getTransportState();
        if (!current?.isPlaying || !programme.isCurrent()) {
            return null;
        }
        const midiWindows: NonNullable<Awaited<ReturnType<typeof prepareInitialMidiWindow>>>[] = [];
        for (const window of windows) {
            const prepared = await prepareInitialMidiWindow(window.from, window.to, current, cancellation, programme);
            if (!prepared || !programme.isCurrent()) {
                return null;
            }
            midiWindows.push(prepared);
        }
        return {
            isCurrent: programme.isCurrent,
            midiWindow: (fromBeat: number, toBeat: number) => {
                const prepared = midiWindows.find((window) => window.fromBeat === fromBeat && window.toBeat === toBeat);
                if (!prepared) {
                    throw new Error('Initial playback requested an unprepared MIDI window');
                }
                return prepared;
            },
        };
    }
    return {
        generation,
        epoch,
        seam,
        ownsSession,
        yeastRouteLineage: cancellation.yeastRouteLineage,
        isCurrent: originalProgramme.isCurrent,
        prepareMidiWindows,
    };
}

export type PreparedInitialBrowserPlayback = NonNullable<ReturnType<typeof prepareInitialBrowserPlayback>>;
