import {
    type LoopAudioScheduleState,
    type OwnedWindow,
    type Pass,
    type Refill,
    type Runtime,
} from '../../../models/LoopAudioScheduleState';
import { type SourceWithFade } from '../../../models/SourceWithFade';
import { scheduleAudioClips } from '../../scheduling/scheduleAudioClips';
import { scheduleFrozenTrack } from '../../scheduling/scheduleFrozenTrack';
import { fenceSource } from '../fenceSource';

import { type createLoopAudioPasses } from './createLoopAudioPasses';
import { type createLoopAudioProgramme } from './createLoopAudioProgramme';

type PassRuntime = ReturnType<typeof createLoopAudioPasses>;
type ProgrammeRuntime = ReturnType<typeof createLoopAudioProgramme>;
type ProgrammeRead = ReturnType<ProgrammeRuntime['readProgramme']>;
function emit(
    state: LoopAudioScheduleState,
    runtime: Runtime,
    passRuntime: PassRuntime,
    window: OwnedWindow,
    input: Refill,
    eligible: ProgrammeRead['eligible']
): void {
    const pass = state.passes.get(window.passIndex) ?? passRuntime.poolAt(window.anchorTime, window.passIndex !== 0);
    if (!pass) {
        throw new Error('Loop audio window has no representable pass owner');
    }
    if (!window.frozenMidi) {
        scheduleAudioClips(
            window.fromBeat,
            window.toBeat,
            window.anchorBeat,
            pass.audio,
            pass.frozen,
            pass.sources,
            input.transport,
            window.anchorTime
        );
    }
    for (const track of eligible) {
        if (track.kind !== 'midi' || track.freezeState.status !== 'frozen' || !track.freezeState.frozenBufferId) {
            continue;
        }
        if (window.frozenMidi ? track.id !== window.frozenMidi.trackId : pass.externalFrozenTracks.has(track.id)) {
            continue;
        }
        const key = `${track.id}:${track.freezeState.frozenBufferId}`;
        if (pass.frozen.has(key)) {
            continue;
        }
        if (
            scheduleFrozenTrack(
                track,
                window.frozenMidi?.clock.anchorBeat ?? window.anchorBeat,
                pass.sources,
                input.transport.tempo,
                window.frozenMidi ? window.frozenMidi.clock.floorBeat : window.fromBeat,
                window.frozenMidi ? undefined : window.anchorTime,
                window.frozenMidi?.clock
            )
        ) {
            pass.frozen.add(key);
        }
    }
    for (const source of pass.sources as SourceWithFade[]) {
        fenceSource(source, runtime.context, pass.end + (source.compensationSeconds ?? 0));
    }
}
function rollbackWindow(
    state: LoopAudioScheduleState,
    passRuntime: PassRuntime,
    window: OwnedWindow,
    existing: Pass | undefined,
    sourcesBefore: Set<AudioBufferSourceNode>,
    audioBefore: Set<string>,
    frozenBefore: Set<string>
): void {
    const pass = state.passes.get(window.passIndex);
    if (pass) {
        for (let index = pass.sources.length - 1; index >= 0; index--) {
            const source = pass.sources[index]!;
            if (!sourcesBefore.has(source)) {
                passRuntime.retireSource(source);
                pass.sources.splice(index, 1);
            }
        }
        pass.audio.clear();
        pass.frozen.clear();
        for (const key of audioBefore) {
            pass.audio.add(key);
        }
        for (const key of frozenBefore) {
            pass.frozen.add(key);
        }
        for (const source of sourcesBefore as Set<SourceWithFade>) {
            if (!pass.sources.includes(source)) {
                if (source.scheduledAudioKey) {
                    pass.audio.delete(source.scheduledAudioKey);
                }
                if (source.scheduledFrozenKey) {
                    pass.frozen.delete(source.scheduledFrozenKey);
                }
            }
        }
        if (!existing) {
            state.passes.delete(window.passIndex);
        }
    }
}
function prepareWindow(
    state: LoopAudioScheduleState,
    runtime: Runtime,
    passRuntime: PassRuntime,
    programmeRuntime: ProgrammeRuntime,
    window: OwnedWindow,
    input: Refill,
    eligible: ProgrammeRead['eligible'],
    reconcile?: Pass
): Pass {
    const existing = state.passes.get(window.passIndex);
    const sourcesBefore = new Set(existing?.sources ?? []);
    const audioBefore = new Set(existing?.audio ?? []);
    const frozenBefore = new Set(existing?.frozen ?? []);
    try {
        if (reconcile) {
            programmeRuntime.reconcileCurrent(reconcile, eligible);
        }
        emit(state, runtime, passRuntime, window, input, eligible);
    } catch (error) {
        rollbackWindow(state, passRuntime, window, existing, sourcesBefore, audioBefore, frozenBefore);
        throw error;
    }
    return state.passes.get(window.passIndex)!;
}
export function createLoopAudioEmitter(
    state: LoopAudioScheduleState,
    runtime: Runtime,
    passRuntime: PassRuntime,
    programmeRuntime: ProgrammeRuntime
) {
    return {
        prepareWindow: (window: OwnedWindow, input: Refill, eligible: ProgrammeRead['eligible'], reconcile?: Pass) =>
            prepareWindow(state, runtime, passRuntime, programmeRuntime, window, input, eligible, reconcile),
    };
}
