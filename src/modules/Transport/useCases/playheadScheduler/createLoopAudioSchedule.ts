import { type LoopAudioScheduleLifetime } from '../../models/LoopAudioScheduleLifetime';
import { type Input, type LoopAudioScheduleState } from '../../models/LoopAudioScheduleState';

import { createLoopAudioCoverage } from './loopAudio/createLoopAudioCoverage';
import { createLoopAudioEmitter } from './loopAudio/createLoopAudioEmitter';
import { createLoopAudioPasses } from './loopAudio/createLoopAudioPasses';
import { createLoopAudioProgramme } from './loopAudio/createLoopAudioProgramme';
import { createLoopAudioRefill } from './loopAudio/createLoopAudioRefill';
import { createLoopFrozenWindows } from './loopAudio/createLoopFrozenWindows';
/** One disposable execution instance; every collaborator reads its current state. */
export function createLoopAudioSchedule({ context, isCurrent, monotonicTime = () => performance.now() }: Input) {
    const runtime = {
        context,
        isCurrent: () => isCurrent(),
        monotonicTime: () => monotonicTime(),
    };
    const state: LoopAudioScheduleState = {
        passes: new Map(),
        dirtyPasses: new Map(),
        anchor: null,
        geometry: null,
        programme: null,
        buffers: new Map(),
        active: false,
        recoveredThisRefill: false,
        preparedThrough: 0,
        currentInput: null,
        coverage: { from: 0, through: 0, target: 0, completionAudioTime: 0, windows: 0, shortfall: null },
    };
    const passRuntime = createLoopAudioPasses(state, runtime);
    const programmeRuntime = createLoopAudioProgramme(state, runtime, passRuntime);
    const emitter = createLoopAudioEmitter(state, runtime, passRuntime, programmeRuntime);
    const coverageRuntime = createLoopAudioCoverage(state, runtime, passRuntime, programmeRuntime, emitter);
    const frozenWindows = createLoopFrozenWindows(state, runtime, passRuntime, coverageRuntime);
    const refillRuntime = createLoopAudioRefill(
        state,
        runtime,
        passRuntime,
        programmeRuntime,
        emitter,
        coverageRuntime
    );
    const schedule = {
        refill: refillRuntime.refill,
        poolAt: passRuntime.poolAt,
        fence: passRuntime.fence,
        reset: passRuntime.reset,
        recoverMappedWindow: coverageRuntime.recoverMappedWindow,
        watchFrozenMidiWindow: frozenWindows.watchFrozenMidiWindow,
        get active() {
            return state.active;
        },
        get coverage() {
            return coverageRuntime.snapshot();
        },
    };
    return schedule satisfies LoopAudioScheduleLifetime;
}
