import { valuesEqual } from '#/utils/structuralEquality';

import {
    type Coverage,
    type LoopAudioScheduleState,
    type OwnedWindow,
    type Reconciliation,
    type Refill,
    type Runtime,
} from '../../../models/LoopAudioScheduleState';
import { secondsBetweenBeats } from '../../../models/TempoMap';
import { projectLoopAudioWindows } from '../projectLoopAudioWindows';

import { type createLoopAudioCoverage } from './createLoopAudioCoverage';
import { type createLoopAudioEmitter } from './createLoopAudioEmitter';
import { type createLoopAudioPasses } from './createLoopAudioPasses';
import { type createLoopAudioProgramme } from './createLoopAudioProgramme';

type PassRuntime = ReturnType<typeof createLoopAudioPasses>;
type ProgrammeRuntime = ReturnType<typeof createLoopAudioProgramme>;
type Emitter = ReturnType<typeof createLoopAudioEmitter>;
type ProgrammeRead = ReturnType<ProgrammeRuntime['readProgramme']>;

type CoverageRuntime = ReturnType<typeof createLoopAudioCoverage>;
function openRefill(
    state: LoopAudioScheduleState,
    runtime: Runtime,
    passRuntime: PassRuntime,
    coverageRuntime: CoverageRuntime,
    input: Refill
): Coverage | null {
    const { transport, changes, position, audioTime } = input;
    if (!runtime.isCurrent()) {
        passRuntime.reset();
        state.coverage.shortfall = 'retired';
        return coverageRuntime.reportCoverage();
    }
    const enabled = transport.isLooping && transport.loopEnd > transport.loopStart && position < transport.loopEnd;
    if (!enabled) {
        if (state.active) {
            passRuntime.reset();
        }
        return coverageRuntime.reportCoverage();
    }
    const nextGeometry = [
        transport.tempo,
        transport.loopStart,
        transport.loopEnd,
        changes.map((change) => [change.beat, change.tempo, change.curve]),
    ];
    if (!valuesEqual(nextGeometry, state.geometry)) {
        passRuntime.reset();
    }
    if (!state.anchor) {
        const duration = secondsBetweenBeats(changes, transport.loopStart, transport.loopEnd, transport.tempo);
        const firstEnd = audioTime + secondsBetweenBeats(changes, position, transport.loopEnd, transport.tempo);
        if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(firstEnd) || firstEnd <= audioTime) {
            return coverageRuntime.refuseUnrepresentable(audioTime);
        }
        state.anchor = { beat: position, time: audioTime, firstEnd, duration };
        state.preparedThrough = audioTime;
        state.geometry = nextGeometry;
        state.active = true;
        state.coverage = {
            from: audioTime,
            through: audioTime,
            target: audioTime,
            completionAudioTime: runtime.context.currentTime,
            windows: 0,
            shortfall: null,
        };
    }
    const currentIndex = passRuntime.indexAt(audioTime, false);
    if (!Number.isSafeInteger(currentIndex)) {
        return coverageRuntime.refuseUnrepresentable(audioTime);
    }
    passRuntime.prune(currentIndex);
    return null;
}
function beginCoverage(
    state: LoopAudioScheduleState,
    runtime: Runtime,
    coverageRuntime: CoverageRuntime,
    audioTime: number
): void {
    const from = Math.max(audioTime, state.preparedThrough);
    state.coverage = {
        from: audioTime,
        through: from,
        target: audioTime + 0.35,
        completionAudioTime: runtime.context.currentTime,
        windows: 0,
        shortfall: null,
    };
    coverageRuntime.refreshTarget(audioTime);
}
function finishEmptyProgramme(
    state: LoopAudioScheduleState,
    passRuntime: PassRuntime,
    coverageRuntime: CoverageRuntime
): Coverage {
    for (const pass of state.passes.values()) {
        passRuntime.retirePass(pass);
    }
    state.passes.clear();
    state.dirtyPasses.clear();
    state.coverage.through = state.coverage.target;
    state.preparedThrough = state.coverage.target;
    return coverageRuntime.reportCoverage();
}
function prepareNextWindow(
    state: LoopAudioScheduleState,
    runtime: Runtime,
    passRuntime: PassRuntime,
    coverageRuntime: CoverageRuntime,
    emitter: Emitter,
    input: Refill,
    read: ProgrammeRead,
    dirty: Reconciliation | undefined,
    frame: Refill
): Coverage | null {
    const { transport, changes, audioTime } = frame;
    let projected: ReturnType<typeof projectLoopAudioWindows> | null = null;
    if (!dirty) {
        projected = projectLoopAudioWindows({
            transport,
            changes,
            anchorBeat: state.anchor!.beat,
            anchorTime: state.anchor!.time,
            fromTime: Math.max(state.coverage.through, state.coverage.completionAudioTime),
            toTime: state.coverage.target,
            maxWindows: 1,
        });
    }
    const window: OwnedWindow | undefined = dirty ? dirty.windows[dirty.next] : projected?.windows[0];
    if (!window) {
        if (projected?.shortfall === 'unrepresentable') {
            return coverageRuntime.refuseUnrepresentable(audioTime);
        }
        state.coverage.shortfall = projected?.shortfall ?? 'unrepresentable';
        return coverageRuntime.reportCoverage();
    }
    if (!dirty && window.fromTime > state.coverage.through) {
        // A clock which outruns preparation has already rendered the
        // missed span. Recover from its current mapped pass directly.
        state.coverage.from = window.fromTime;
    }
    if (!runtime.isCurrent()) {
        passRuntime.reset();
        state.coverage.shortfall = 'retired';
        return coverageRuntime.reportCoverage();
    }
    const pass = emitter.prepareWindow(window, input, read.eligible, dirty?.pass);
    if (dirty) {
        state.dirtyPasses.delete(dirty.pass);
        dirty.next++;
        if (dirty.next < dirty.windows.length) {
            state.dirtyPasses.set(dirty.pass, dirty);
        }
    } else {
        passRuntime.rememberWindow(pass, window);
    }
    if (!read.available) {
        // Keep the existing mapped recovery for ready tracks, without
        // claiming that a window missing media was fully admitted.
        state.coverage.shortfall = 'media-unavailable';
        coverageRuntime.refreshTarget(audioTime);
        return coverageRuntime.reportCoverage();
    }
    state.coverage.windows++;
    if (!dirty) {
        state.coverage.through = window.toTime;
        state.preparedThrough = window.toTime;
    }
    return null;
}
function refill(
    state: LoopAudioScheduleState,
    runtime: Runtime,
    passRuntime: PassRuntime,
    programmeRuntime: ProgrammeRuntime,
    emitter: Emitter,
    coverageRuntime: CoverageRuntime,
    input: Refill
): Coverage {
    state.currentInput = input;
    state.recoveredThisRefill = false;
    const { transport, changes, position, audioTime } = input;
    const started = runtime.monotonicTime();
    const frame = { transport, changes, position, audioTime };
    const early = openRefill(state, runtime, passRuntime, coverageRuntime, frame);
    if (early) {
        return early;
    }
    const read = programmeRuntime.reconcileInputs(frame);
    beginCoverage(state, runtime, coverageRuntime, audioTime);
    if (!read.hasMaterial) {
        return finishEmptyProgramme(state, passRuntime, coverageRuntime);
    }
    for (let unit = 0; unit < 64; unit++) {
        coverageRuntime.refreshTarget(audioTime);
        const dirty = state.dirtyPasses.values().next().value;
        if (!dirty && state.coverage.through >= state.coverage.target) {
            return coverageRuntime.reportCoverage();
        }
        if (runtime.monotonicTime() - started >= 40) {
            state.coverage.shortfall = 'time-budget';
            return coverageRuntime.reportCoverage();
        }
        const result = prepareNextWindow(
            state,
            runtime,
            passRuntime,
            coverageRuntime,
            emitter,
            input,
            read,
            dirty,
            frame
        );
        if (result) {
            return result;
        }
    }
    coverageRuntime.refreshTarget(audioTime);
    state.coverage.shortfall =
        state.dirtyPasses.size > 0 || state.coverage.through < state.coverage.target ? 'pass-budget' : null;
    return coverageRuntime.reportCoverage();
}
export function createLoopAudioRefill(
    state: LoopAudioScheduleState,
    runtime: Runtime,
    passRuntime: PassRuntime,
    programmeRuntime: ProgrammeRuntime,
    emitter: Emitter,
    coverageRuntime: CoverageRuntime
) {
    return {
        refill: (input: Refill) =>
            refill(state, runtime, passRuntime, programmeRuntime, emitter, coverageRuntime, input),
    };
}
