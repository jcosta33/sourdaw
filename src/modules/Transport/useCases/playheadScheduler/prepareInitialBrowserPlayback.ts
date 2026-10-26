import { trackStore, takeLaneStore } from '#/modules/Arrangement/stores';
import { grooveTemplateStore, midiStore } from '#/modules/MIDI/stores';
import { readYeastRack } from '#/modules/Yeast/stores';
import { valuesEqual } from '#/utils/structuralEquality';

import { getAudioContext } from '#/modules/AudioEngine/useCases';
import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';

import { getTempoAtBeat } from '../../models/TempoMap';
import { getTransportState } from '../../repositories/transport/getTransportState';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { prepareInitialMidiWindow, type SchedulerCancellation } from '../scheduling/scheduleMidiNotes';

import {
    INITIAL_HIGH_WATER_OFFSET_BEATS,
    projectLoopSeamWindow,
    SCHEDULE_AHEAD_SECONDS,
} from './projectLoopSeamWindow';
import { schedulerSession } from './schedulerSession';

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

/** A source witness captured before any external readiness wait. */
function captureInitialMidiProgramme(cancellation: SchedulerCancellation) {
    const trackState = trackStore.value;
    const midiState = midiStore.value;
    const takeState = takeLaneStore.value;
    const grooveState = grooveTemplateStore.value;
    const tempoState = tempoMapStore.value;
    const meterState = timeSignatureMapStore.value;
    const racks = (trackState?.tracks ?? []).flatMap((track) =>
        track.devices
            .filter((device) => device.type === 'yeast')
            .map((device) => ({ id: device.id, processors: structuredClone(readYeastRack(device.id).processors) }))
    );
    const isCurrent = () =>
        cancellation.isCurrent() &&
        racks.every((rack) => valuesEqual(readYeastRack(rack.id).processors, rack.processors)) &&
        trackStore.value === trackState &&
        midiStore.value === midiState &&
        takeLaneStore.value === takeState &&
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
    const lookAheadBeats = (SCHEDULE_AHEAD_SECONDS * getTempoAtBeat(changes, position, state.tempo)) / 60;
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
    const windows = seam
        ? [
              { from, to: state.loopEnd },
              { from: state.loopStart, to: seam.wrappedUpTo },
          ]
        : [{ from, to: position + lookAheadBeats }];
    const originalProgramme = captureInitialMidiProgramme(cancellation);
    // Called immediately after the scheduler's synchronous recording writes.
    // Its new witness includes those clips and takes, and still rejects any
    // source edit arriving while audio admission or Yeast readiness is pending.
    function prepareMidiWindows() {
        const programme = captureInitialMidiProgramme(cancellation);
        return prepareWindows(programme);
    }
    async function prepareWindows(programme: ReturnType<typeof captureInitialMidiProgramme>) {
        const midiWindows: NonNullable<Awaited<ReturnType<typeof prepareInitialMidiWindow>>>[] = [];
        for (const window of windows) {
            const prepared = await prepareInitialMidiWindow(window.from, window.to, state, cancellation, programme);
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
