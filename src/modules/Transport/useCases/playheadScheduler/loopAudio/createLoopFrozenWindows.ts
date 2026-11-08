import { type LoopAudioScheduleState, type Pass, type Runtime } from '../../../models/LoopAudioScheduleState';
import { type SourceWithFade } from '../../../models/SourceWithFade';
import { secondsBetweenBeats } from '../../../models/TempoMap';
import { fenceSource } from '../fenceSource';

import { type createLoopAudioCoverage } from './createLoopAudioCoverage';
import { type createLoopAudioPasses } from './createLoopAudioPasses';

type PassRuntime = ReturnType<typeof createLoopAudioPasses>;

type CoverageRuntime = ReturnType<typeof createLoopAudioCoverage>;
function retainSource(
    state: LoopAudioScheduleState,
    runtime: Runtime,
    passRuntime: PassRuntime,
    pool: Pass,
    source: SourceWithFade,
    fromBeat: number,
    toBeat: number
): void {
    const clock = source.scheduledFrozenWindow;
    if (!clock || !source.scheduledTrackId) {
        throw new Error('Frozen MIDI source has no admitted clock');
    }
    if (source.scheduledBufferId && source.buffer) {
        state.buffers.set(source.scheduledBufferId, source.buffer);
    }
    pool.externalFrozenTracks.add(source.scheduledTrackId);
    if (!state.anchor || !state.currentInput) {
        throw new Error('Frozen MIDI window has no loop anchor');
    }
    const canonicalBeat = pool.index === 0 ? state.anchor.beat : state.currentInput.transport.loopStart;
    const canonicalTime =
        pool.index === 0 ? state.anchor.time : state.anchor.firstEnd + (pool.index - 1) * state.anchor.duration;
    const toCanonical = secondsBetweenBeats(
        state.currentInput.changes,
        clock.anchorBeat,
        canonicalBeat,
        state.currentInput.transport.tempo
    );
    const floorUsed = clock.floorBeat !== null && clock.floorBeat > (source.scheduledFrozenOriginBeat ?? 0);
    const noncanonical =
        clock.anchorTime + toCanonical !== canonicalTime ||
        (floorUsed && clock.floorAnchorTime + toCanonical !== canonicalTime);
    passRuntime.rememberWindow(pool, {
        passIndex: pool.index,
        anchorBeat: clock.anchorBeat,
        anchorTime: clock.anchorTime,
        fromBeat,
        toBeat,
        fromTime: source.scheduledStartTime!,
        toTime: Math.min(source.scheduledEndTime!, pool.end + (source.compensationSeconds ?? 0)),
        passEndTime: pool.end,
        frozenMidi: {
            trackId: source.scheduledTrackId,
            clock: {
                anchorBeat: clock.anchorBeat,
                anchorTime: clock.anchorTime,
                floorAnchorTime: clock.floorAnchorTime,
                floorBeat: clock.floorBeat,
                initialFloor: clock.initialFloor,
            },
            noncanonical,
        },
    });
    fenceSource(source, runtime.context, pool.end + (source.compensationSeconds ?? 0));
}
function retainBatch(
    state: LoopAudioScheduleState,
    runtime: Runtime,
    passRuntime: PassRuntime,
    coverageRuntime: CoverageRuntime,
    before: Set<AudioBufferSourceNode>,
    pool: Pass | null,
    fromBeat: number,
    toBeat: number,
    failed: boolean
): void {
    if (!pool) {
        return;
    }
    const current = state.active && runtime.isCurrent() && state.passes.get(pool.index) === pool;
    for (let index = pool.sources.length - 1; index >= 0; index--) {
        const source: SourceWithFade = pool.sources[index]!;
        if (before.has(source) || !source.scheduledFrozenKey) {
            continue;
        }
        if (failed || !current) {
            passRuntime.retireSource(source);
            pool.sources.splice(index, 1);
            pool.frozen.delete(source.scheduledFrozenKey);
            continue;
        }
        retainSource(state, runtime, passRuntime, pool, source, fromBeat, toBeat);
    }
    coverageRuntime.reportCoverage();
}
function watchFrozenMidiWindow(
    state: LoopAudioScheduleState,
    runtime: Runtime,
    passRuntime: PassRuntime,
    coverageRuntime: CoverageRuntime,
    pool: Pass | null,
    fromBeat: number,
    toBeat: number
) {
    const before = new Set(pool?.sources ?? []);
    return (emission: Promise<void>): Promise<void> =>
        emission.then(
            () => retainBatch(state, runtime, passRuntime, coverageRuntime, before, pool, fromBeat, toBeat, false),
            (error: unknown) => {
                retainBatch(state, runtime, passRuntime, coverageRuntime, before, pool, fromBeat, toBeat, true);
                throw error;
            }
        );
}
export function createLoopFrozenWindows(
    state: LoopAudioScheduleState,
    runtime: Runtime,
    passRuntime: PassRuntime,
    coverageRuntime: CoverageRuntime
) {
    return {
        watchFrozenMidiWindow: (pool: Pass | null, fromBeat: number, toBeat: number) =>
            watchFrozenMidiWindow(state, runtime, passRuntime, coverageRuntime, pool, fromBeat, toBeat),
    };
}
