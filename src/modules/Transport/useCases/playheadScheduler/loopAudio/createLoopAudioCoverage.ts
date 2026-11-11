import {
    type Coverage,
    type LoopAudioScheduleState,
    type OwnedWindow,
    type Pass,
    type Refill,
    type Runtime,
} from '../../../models/LoopAudioScheduleState';
import { type SourceWithFade } from '../../../models/SourceWithFade';
import { secondsBetweenBeats } from '../../../models/TempoMap';

import { type createLoopAudioEmitter } from './createLoopAudioEmitter';
import { type createLoopAudioPasses } from './createLoopAudioPasses';
import { type createLoopAudioProgramme } from './createLoopAudioProgramme';

type PassRuntime = ReturnType<typeof createLoopAudioPasses>;
type ProgrammeRuntime = ReturnType<typeof createLoopAudioProgramme>;
type Emitter = ReturnType<typeof createLoopAudioEmitter>;
function reportCoverage(state: LoopAudioScheduleState): Coverage {
    for (const pass of state.passes.values()) {
        if (pass.externalFrozenTracks.size === 0) {
            continue;
        }
        const noncanonical = new Set(
            pass.windows.flatMap((window) => (window.frozenMidi?.noncanonical ? [window.frozenMidi.trackId] : []))
        );
        if (
            pass.sources.some(
                (source: SourceWithFade) =>
                    source.scheduledFrozenKey !== undefined &&
                    source.scheduledTrackId !== undefined &&
                    noncanonical.has(source.scheduledTrackId) &&
                    Math.min(source.scheduledEndTime ?? Infinity, source.scheduledStopTime ?? Infinity) >
                        state.coverage.completionAudioTime
            )
        ) {
            state.coverage.through = Math.min(state.coverage.through, state.coverage.from);
            state.coverage.shortfall ??= 'noncanonical-frozen-window';
            break;
        }
    }
    return state.coverage;
}
function refuseUnrepresentable(
    state: LoopAudioScheduleState,
    runtime: Runtime,
    passRuntime: PassRuntime,
    audioTime: number
): Coverage {
    passRuntime.reset();
    const completionAudioTime = runtime.context.currentTime;
    const from = Math.max(audioTime, completionAudioTime);
    state.coverage = {
        from,
        through: from,
        target: from + 0.35,
        completionAudioTime,
        windows: 0,
        shortfall: 'unrepresentable',
    };
    return state.coverage;
}
function recoverMappedWindow(
    state: LoopAudioScheduleState,
    runtime: Runtime,
    passRuntime: PassRuntime,
    programmeRuntime: ProgrammeRuntime,
    emitter: Emitter,
    pool: Pass | null,
    fromBeat: number,
    toBeat: number,
    input: Refill
): boolean {
    if (
        state.recoveredThisRefill ||
        !state.active ||
        !state.anchor ||
        !pool ||
        state.passes.get(pool.index) !== pool ||
        !runtime.isCurrent() ||
        state.coverage.through > Math.max(input.audioTime, runtime.context.currentTime)
    ) {
        return false;
    }
    const endBeat = Math.min(toBeat, input.transport.loopEnd);
    if (fromBeat > endBeat) {
        return false;
    }
    state.recoveredThisRefill = true;
    const started = runtime.monotonicTime();
    const anchorBeat = pool.index === 0 ? state.anchor.beat : input.transport.loopStart;
    const anchorTime =
        pool.index === 0 ? state.anchor.time : state.anchor.firstEnd + (pool.index - 1) * state.anchor.duration;
    const window: OwnedWindow = {
        passIndex: pool.index,
        anchorBeat,
        anchorTime,
        fromBeat,
        toBeat: endBeat,
        fromTime: anchorTime + secondsBetweenBeats(input.changes, anchorBeat, fromBeat, input.transport.tempo),
        toTime: anchorTime + secondsBetweenBeats(input.changes, anchorBeat, endBeat, input.transport.tempo),
        passEndTime: pool.end,
    };
    const read = programmeRuntime.readProgramme(input.transport);
    emitter.prepareWindow(window, input, read.eligible);
    passRuntime.rememberWindow(pool, window);
    state.coverage.completionAudioTime = runtime.context.currentTime;
    state.coverage.target = Math.max(input.audioTime, state.coverage.completionAudioTime) + 0.35;
    state.coverage.shortfall ??= 'coverage-expired';
    state.coverage.recovery = { window, elapsedMilliseconds: runtime.monotonicTime() - started };
    return true;
}
function refreshTarget(state: LoopAudioScheduleState, runtime: Runtime, audioTime: number): void {
    state.coverage.completionAudioTime = runtime.context.currentTime;
    state.coverage.target = Math.max(audioTime, state.coverage.completionAudioTime) + 0.35;
}
function snapshot(state: LoopAudioScheduleState): Coverage {
    const snapshot: Coverage = {
        from: state.coverage.from,
        through: state.coverage.through,
        target: state.coverage.target,
        completionAudioTime: state.coverage.completionAudioTime,
        windows: state.coverage.windows,
        shortfall: state.coverage.shortfall,
    };
    if (Object.hasOwn(state.coverage, 'recovery')) {
        snapshot.recovery = state.coverage.recovery;
    }
    return snapshot;
}
export function createLoopAudioCoverage(
    state: LoopAudioScheduleState,
    runtime: Runtime,
    passRuntime: PassRuntime,
    programmeRuntime: ProgrammeRuntime,
    emitter: Emitter
) {
    return {
        reportCoverage: () => reportCoverage(state),
        refuseUnrepresentable: (audioTime: number) => refuseUnrepresentable(state, runtime, passRuntime, audioTime),
        recoverMappedWindow: (pool: Pass | null, fromBeat: number, toBeat: number, input: Refill) =>
            recoverMappedWindow(state, runtime, passRuntime, programmeRuntime, emitter, pool, fromBeat, toBeat, input),
        refreshTarget: (audioTime: number) => refreshTarget(state, runtime, audioTime),
        snapshot: () => snapshot(state),
    };
}
