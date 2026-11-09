import {
    type LoopAudioScheduleState,
    type OwnedWindow,
    type Pass,
    type Runtime,
} from '../../../models/LoopAudioScheduleState';
import { type SourceWithFade } from '../../../models/SourceWithFade';
import { cutSource } from '../cutSource';
import { fenceSource } from '../fenceSource';

function retireSource(runtime: Runtime, source: SourceWithFade): void {
    if (
        Math.min(source.scheduledEndTime ?? Infinity, source.scheduledStopTime ?? Infinity) <=
        runtime.context.currentTime
    ) {
        return;
    }
    if (source.scheduledStartTime !== undefined && source.scheduledStartTime >= runtime.context.currentTime) {
        source.stop(runtime.context.currentTime);
        source.scheduledStopTime = runtime.context.currentTime;
    } else {
        cutSource(source, runtime.context);
        source.scheduledStopTime = runtime.context.currentTime + 0.005;
    }
}

function retirePass(runtime: Runtime, pass: Pass): void {
    for (const source of pass.sources) {
        retireSource(runtime, source);
    }
    pass.sources.length = 0;
    pass.audio.clear();
    pass.frozen.clear();
}

function reset(state: LoopAudioScheduleState, runtime: Runtime): void {
    for (const pass of state.passes.values()) {
        retirePass(runtime, pass);
    }
    state.passes.clear();
    state.dirtyPasses.clear();
    state.anchor = null;
    state.geometry = null;
    state.programme = null;
    state.buffers.clear();
    state.active = false;
    state.preparedThrough = runtime.context.currentTime;
    state.coverage = {
        from: runtime.context.currentTime,
        through: runtime.context.currentTime,
        target: runtime.context.currentTime,
        completionAudioTime: runtime.context.currentTime,
        windows: 0,
        shortfall: null,
    };
}

function indexAt(state: LoopAudioScheduleState, time: number, boundary: boolean): number {
    if (!state.anchor || time < state.anchor.firstEnd) {
        return 0;
    }
    const offset = (time - state.anchor.firstEnd) / state.anchor.duration;
    let index = (boundary ? Math.round(offset) : Math.floor(offset)) + 1;
    if (!boundary) {
        if (state.anchor.firstEnd + index * state.anchor.duration <= time) {
            index++;
        }
        if (index > 0 && state.anchor.firstEnd + (index - 1) * state.anchor.duration > time) {
            index--;
        }
    }
    return index;
}

function poolAt(state: LoopAudioScheduleState, time: number, boundary = false): Pass | null {
    if (!state.active || !state.anchor) {
        return null;
    }
    const index = indexAt(state, time, boundary);
    if (!Number.isSafeInteger(index) || index < 0) {
        return null;
    }
    let pass = state.passes.get(index);
    if (!pass) {
        const end = state.anchor.firstEnd + index * state.anchor.duration;
        if (!Number.isFinite(end)) {
            return null;
        }
        pass = {
            index,
            end,
            audio: new Set(),
            frozen: new Set(),
            sources: [],
            windows: [],
            externalFrozenTracks: new Set(),
        };
        state.passes.set(index, pass);
    }
    return pass;
}

function fence(state: LoopAudioScheduleState, runtime: Runtime): void {
    for (const pass of state.passes.values()) {
        for (const source of pass.sources as SourceWithFade[]) {
            fenceSource(source, runtime.context, pass.end + (source.compensationSeconds ?? 0));
        }
    }
}

function rememberWindow(pass: Pass, window: OwnedWindow): void {
    if (window.frozenMidi) {
        const existing = pass.windows.findIndex((entry) => entry.frozenMidi?.trackId === window.frozenMidi?.trackId);
        if (existing >= 0) {
            pass.windows[existing] = window;
            return;
        }
    }
    const last = pass.windows.at(-1);
    if (last && !last.frozenMidi && !window.frozenMidi && window.fromTime <= last.toTime) {
        if (window.toTime > last.toTime) {
            pass.windows[pass.windows.length - 1] = { ...last, toBeat: window.toBeat, toTime: window.toTime };
        }
    } else {
        pass.windows.push(window);
    }
}

function prune(state: LoopAudioScheduleState, runtime: Runtime, currentIndex: number): void {
    for (const [index, pass] of state.passes) {
        if (
            index < currentIndex &&
            pass.sources.every(
                (source: SourceWithFade) =>
                    Math.min(source.scheduledEndTime ?? Infinity, source.scheduledStopTime ?? Infinity) <=
                    runtime.context.currentTime
            )
        ) {
            state.passes.delete(index);
            state.dirtyPasses.delete(pass);
        }
    }
}
export function createLoopAudioPasses(state: LoopAudioScheduleState, runtime: Runtime) {
    return {
        retireSource: (source: SourceWithFade) => retireSource(runtime, source),
        retirePass: (pass: Pass) => retirePass(runtime, pass),
        reset: () => reset(state, runtime),
        indexAt: (time: number, boundary: boolean) => indexAt(state, time, boundary),
        poolAt: (time: number, boundary = false) => poolAt(state, time, boundary),
        fence: () => fence(state, runtime),
        rememberWindow,
        prune: (currentIndex: number) => prune(state, runtime, currentIndex),
    };
}
