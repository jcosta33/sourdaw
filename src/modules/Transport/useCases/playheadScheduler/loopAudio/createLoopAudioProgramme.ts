import { gainEnvelopeStore, trackStore } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import { getCachedAudioBuffer, getCompensationDelay } from '#/modules/AudioEngine/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { valuesEqual } from '#/utils/structuralEquality';

import {
    type LoopAudioScheduleState,
    type Pass,
    type Refill,
    type Runtime,
} from '../../../models/LoopAudioScheduleState';
import { type SourceWithFade } from '../../../models/SourceWithFade';
import { type TransportState } from '../../../models/TransportState';

import { type createLoopAudioPasses } from './createLoopAudioPasses';

type PassRuntime = ReturnType<typeof createLoopAudioPasses>;
const CLIP_FIELDS = [
    'id',
    'type',
    'muted',
    'startBeat',
    'endBeat',
    'regionStartBeat',
    'regionEndBeat',
    'audioBufferId',
    'audioOffsetSeconds',
    'audioOffsetBeats',
    'audioUnwrappedOffsetSeconds',
    'audioLoopStartSeconds',
    'audioLoopPassEntrySeconds',
    'audioLoopPassOriginBeat',
    'loopEnabled',
    'loopLength',
    'loopOriginBeat',
    'stretchMode',
    'stretchRatio',
    'gain',
    'fadeInBeats',
    'fadeOutBeats',
] as const;

function readProgramme(state: LoopAudioScheduleState, transport: TransportState) {
    const tracks = trackStore.value?.tracks ?? [];
    const buses = new Set(tracks.filter((track) => track.kind === 'bus').map((track) => track.id));
    const eligible = tracks.filter(
        (track) =>
            (track.kind === 'audio' ||
                (track.kind === 'midi' &&
                    (track.freezeState.status !== 'frozen' || !track.freezeState.frozenBufferId || midiStore.value))) &&
            (!track.muted || track.sends.some((send) => send.preFader && buses.has(send.busId)))
    );
    const cached = new Map<string, AudioBuffer | null>();
    let available = true;
    let hasMaterial = false;
    const view = eligible.map((track) => {
        const frozen = track.freezeState.status === 'frozen' ? track.freezeState.frozenBufferId : undefined;
        let parts: ReturnType<typeof resolveClipsWithComping> = [];
        if (!frozen) {
            parts = resolveClipsWithComping(track.id, track.clips).filter(
                (part) =>
                    part.type === 'audio' &&
                    !part.muted &&
                    part.startBeat < transport.loopEnd &&
                    part.endBeat > Math.min(state.anchor?.beat ?? transport.loopStart, transport.loopStart)
            );
        }
        const media = frozen ? [frozen] : parts.flatMap((part) => (part.audioBufferId ? [part.audioBufferId] : []));
        for (const bufferId of media) {
            const buffer = getCachedAudioBuffer({ bufferId });
            cached.set(bufferId, buffer);
            available = available && buffer !== null;
            hasMaterial = true;
        }
        let compensation: number;
        if (frozen) {
            compensation = track.freezeState.compensationSeconds ?? getCompensationDelay(track.id);
        } else {
            compensation = getCompensationDelay(track.id);
        }
        return {
            id: track.id,
            kind: track.kind,
            frozen,
            compensation,
            origin: frozen ? track.clips.map((clip) => clip.startBeat) : [],
            parts: parts.map((part) => CLIP_FIELDS.map((field) => part[field])),
            envelopes: parts.map((part) => {
                const envelope = gainEnvelopeStore.value?.envelopes[part.id];
                if (!envelope) {
                    return null;
                }
                return {
                    enabled: envelope.enabled,
                    points: envelope.points.map((point) => [point.beatOffset, point.gainDb]),
                };
            }),
        };
    });
    return { eligible, view, cached, available, hasMaterial };
}
function reconcileCurrent(
    passRuntime: PassRuntime,
    pass: Pass,
    eligible: ReturnType<typeof readProgramme>['eligible']
): void {
    const byId = new Map(eligible.map((track) => [track.id, track]));
    for (let index = pass.sources.length - 1; index >= 0; index--) {
        const source: SourceWithFade = pass.sources[index]!;
        const track = source.scheduledTrackId ? byId.get(source.scheduledTrackId) : undefined;
        const frozenKey =
            track?.freezeState.status === 'frozen' && track.freezeState.frozenBufferId
                ? `${track.id}:${track.freezeState.frozenBufferId}`
                : undefined;
        let obsolete = !track;
        if (track) {
            if (source.scheduledFrozenKey !== undefined) {
                obsolete =
                    source.scheduledFrozenKey !== frozenKey ||
                    source.scheduledFrozenOriginBeat !==
                        (track.clips.length > 0 ? Math.min(...track.clips.map((clip) => clip.startBeat)) : 0) ||
                    source.compensationSeconds !==
                        (track.freezeState.compensationSeconds ?? getCompensationDelay(track.id)) ||
                    (track.freezeState.frozenBufferId !== undefined &&
                        getCachedAudioBuffer({ bufferId: track.freezeState.frozenBufferId }) !== null &&
                        getCachedAudioBuffer({ bufferId: track.freezeState.frozenBufferId }) !== source.buffer);
            } else {
                obsolete = frozenKey !== undefined;
            }
        }
        if (!obsolete) {
            continue;
        }
        passRuntime.retireSource(source);
        pass.sources.splice(index, 1);
        if (source.scheduledAudioKey) {
            pass.audio.delete(source.scheduledAudioKey);
        }
        if (source.scheduledFrozenKey) {
            pass.frozen.delete(source.scheduledFrozenKey);
        }
    }
}
function reconcileInputs(state: LoopAudioScheduleState, runtime: Runtime, passRuntime: PassRuntime, input: Refill) {
    const { transport, audioTime } = input;
    const read = readProgramme(state, transport);
    const programmeChanged = !valuesEqual(state.programme, read.view);
    const changed =
        programmeChanged ||
        [...read.cached].some(
            ([id, buffer]) => buffer !== null && state.buffers.has(id) && buffer !== state.buffers.get(id)
        );
    if (changed) {
        const retained: { pass: Pass; deadline: number }[] = [];
        state.dirtyPasses.clear();
        for (const pass of state.passes.values()) {
            let deadline = Infinity;
            for (let sourceIndex = pass.sources.length - 1; sourceIndex >= 0; sourceIndex--) {
                const source: SourceWithFade = pass.sources[sourceIndex]!;
                deadline = Math.min(deadline, Math.max(runtime.context.currentTime, source.scheduledStartTime ?? 0));
                if (
                    source.scheduledStartTime === undefined ||
                    source.scheduledStartTime < runtime.context.currentTime
                ) {
                    continue;
                }
                passRuntime.retireSource(source);
                pass.sources.splice(sourceIndex, 1);
                if (source.scheduledAudioKey) {
                    pass.audio.delete(source.scheduledAudioKey);
                }
                if (source.scheduledFrozenKey) {
                    pass.frozen.delete(source.scheduledFrozenKey);
                }
            }
            if (pass.windows.length > 0) {
                retained.push({ pass, deadline });
            }
        }
        retained.sort((left, right) => left.deadline - right.deadline || left.pass.index - right.pass.index);
        for (const { pass } of retained) {
            state.dirtyPasses.set(pass, { pass, windows: [...pass.windows], next: 0 });
        }
        state.coverage.through = audioTime;
        state.preparedThrough = audioTime;
        state.programme = read.view;
    }
    if (programmeChanged) {
        state.buffers = new Map();
    }
    for (const [id, buffer] of read.cached) {
        if (buffer !== null) {
            state.buffers.set(id, buffer);
        }
    }

    return read;
}
export function createLoopAudioProgramme(state: LoopAudioScheduleState, runtime: Runtime, passRuntime: PassRuntime) {
    return {
        readProgramme: (transport: TransportState) => readProgramme(state, transport),
        reconcileCurrent: (pass: Pass, eligible: ReturnType<typeof readProgramme>['eligible']) =>
            reconcileCurrent(passRuntime, pass, eligible),
        reconcileInputs: (input: Refill) => reconcileInputs(state, runtime, passRuntime, input),
    };
}
