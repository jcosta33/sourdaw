import { gainEnvelopeStore, trackStore } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import { getCachedAudioBuffer, getCompensationDelay } from '#/modules/AudioEngine/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { valuesEqual } from '#/utils/structuralEquality';

import { type LoopAudioScheduleLifetime } from '../../models/LoopAudioScheduleLifetime';
import { type SourceWithFade } from '../../models/SourceWithFade';
import { secondsBetweenBeats, type TempoChange } from '../../models/TempoMap';
import { type TransportState } from '../../models/TransportState';
import { scheduleAudioClips } from '../scheduling/scheduleAudioClips';
import { scheduleFrozenTrack } from '../scheduling/scheduleFrozenTrack';

import { cutSource } from './cutSource';
import { fenceSource } from './fenceSource';
import { projectLoopAudioWindows } from './projectLoopAudioWindows';

type AudioWindow = ReturnType<typeof projectLoopAudioWindows>['windows'][number];
type OwnedWindow = AudioWindow & {
    frozenMidi?: {
        trackId: string;
        clock: NonNullable<SourceWithFade['scheduledFrozenWindow']>;
        noncanonical: boolean;
    };
};
type Pass = {
    index: number;
    end: number;
    audio: Set<string>;
    frozen: Set<string>;
    sources: AudioBufferSourceNode[];
    windows: OwnedWindow[];
    externalFrozenTracks: Set<string>;
};
type Reconciliation = { pass: Pass; windows: OwnedWindow[]; next: number };
type Coverage = LoopAudioScheduleLifetime['coverage'] & {
    recovery?: { window: OwnedWindow; elapsedMilliseconds: number };
};
type Input = { context: BaseAudioContext; isCurrent: () => boolean; monotonicTime?: () => number };
type Refill = { transport: TransportState; changes: readonly TempoChange[]; position: number; audioTime: number };

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

/** Disposable browser execution state; project inputs are read-only and never published by this owner. */
export function createLoopAudioSchedule({ context, isCurrent, monotonicTime = () => performance.now() }: Input) {
    const passes = new Map<number, Pass>();
    const dirtyPasses = new Map<Pass, Reconciliation>();
    let anchor: { beat: number; time: number; firstEnd: number; duration: number } | null = null;
    let geometry: unknown = null;
    let programme: unknown = null;
    let buffers = new Map<string, AudioBuffer>();
    let active = false;
    let recoveredThisRefill = false;
    let preparedThrough = 0;
    let currentInput: Refill | null = null;
    let coverage: Coverage = { from: 0, through: 0, target: 0, completionAudioTime: 0, windows: 0, shortfall: null };

    function retireSource(source: SourceWithFade): void {
        if (
            Math.min(source.scheduledEndTime ?? Infinity, source.scheduledStopTime ?? Infinity) <= context.currentTime
        ) {
            return;
        }
        if (source.scheduledStartTime !== undefined && source.scheduledStartTime >= context.currentTime) {
            source.stop(context.currentTime);
            source.scheduledStopTime = context.currentTime;
        } else {
            cutSource(source, context);
            source.scheduledStopTime = context.currentTime + 0.005;
        }
    }

    function retirePass(pass: Pass): void {
        for (const source of pass.sources) {
            retireSource(source);
        }
        pass.sources.length = 0;
        pass.audio.clear();
        pass.frozen.clear();
    }

    function reset(): void {
        for (const pass of passes.values()) {
            retirePass(pass);
        }
        passes.clear();
        dirtyPasses.clear();
        anchor = null;
        geometry = null;
        programme = null;
        buffers.clear();
        active = false;
        preparedThrough = context.currentTime;
        coverage = {
            from: context.currentTime,
            through: context.currentTime,
            target: context.currentTime,
            completionAudioTime: context.currentTime,
            windows: 0,
            shortfall: null,
        };
    }

    function indexAt(time: number, boundary: boolean): number {
        if (!anchor || time < anchor.firstEnd) {
            return 0;
        }
        const offset = (time - anchor.firstEnd) / anchor.duration;
        let index = (boundary ? Math.round(offset) : Math.floor(offset)) + 1;
        if (!boundary) {
            if (anchor.firstEnd + index * anchor.duration <= time) {
                index++;
            }
            if (index > 0 && anchor.firstEnd + (index - 1) * anchor.duration > time) {
                index--;
            }
        }
        return index;
    }

    function refuseUnrepresentable(audioTime: number): Coverage {
        reset();
        const completionAudioTime = context.currentTime;
        const from = Math.max(audioTime, completionAudioTime);
        coverage = {
            from,
            through: from,
            target: from + 0.35,
            completionAudioTime,
            windows: 0,
            shortfall: 'unrepresentable',
        };
        return coverage;
    }

    function poolAt(time: number, boundary = false): Pass | null {
        if (!active || !anchor) {
            return null;
        }
        const index = indexAt(time, boundary);
        if (!Number.isSafeInteger(index) || index < 0) {
            return null;
        }
        let pass = passes.get(index);
        if (!pass) {
            const end = anchor.firstEnd + index * anchor.duration;
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
            passes.set(index, pass);
        }
        return pass;
    }

    function fence(): void {
        for (const pass of passes.values()) {
            for (const source of pass.sources as SourceWithFade[]) {
                fenceSource(source, context, pass.end + (source.compensationSeconds ?? 0));
            }
        }
    }

    function readProgramme(transport: TransportState) {
        const tracks = trackStore.value?.tracks ?? [];
        const buses = new Set(tracks.filter((track) => track.kind === 'bus').map((track) => track.id));
        const eligible = tracks.filter(
            (track) =>
                (track.kind === 'audio' ||
                    (track.kind === 'midi' && midiStore.value && track.freezeState.status === 'frozen')) &&
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
                        part.endBeat > Math.min(anchor?.beat ?? transport.loopStart, transport.loopStart)
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

    function reconcileCurrent(pass: Pass, eligible: ReturnType<typeof readProgramme>['eligible']): void {
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
            retireSource(source);
            pass.sources.splice(index, 1);
            if (source.scheduledAudioKey) {
                pass.audio.delete(source.scheduledAudioKey);
            }
            if (source.scheduledFrozenKey) {
                pass.frozen.delete(source.scheduledFrozenKey);
            }
        }
    }

    function emit(window: OwnedWindow, input: Refill, eligible: ReturnType<typeof readProgramme>['eligible']): void {
        const pass = passes.get(window.passIndex) ?? poolAt(window.anchorTime, window.passIndex !== 0);
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
            fenceSource(source, context, pass.end + (source.compensationSeconds ?? 0));
        }
    }

    function prepareWindow(
        window: OwnedWindow,
        input: Refill,
        eligible: ReturnType<typeof readProgramme>['eligible'],
        reconcile?: Pass
    ): Pass {
        const existing = passes.get(window.passIndex);
        const sourcesBefore = new Set(existing?.sources ?? []);
        const audioBefore = new Set(existing?.audio ?? []);
        const frozenBefore = new Set(existing?.frozen ?? []);
        try {
            if (reconcile) {
                reconcileCurrent(reconcile, eligible);
            }
            emit(window, input, eligible);
        } catch (error) {
            const pass = passes.get(window.passIndex);
            if (pass) {
                for (let index = pass.sources.length - 1; index >= 0; index--) {
                    const source = pass.sources[index]!;
                    if (!sourcesBefore.has(source)) {
                        retireSource(source);
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
                    passes.delete(window.passIndex);
                }
            }
            throw error;
        }
        return passes.get(window.passIndex)!;
    }

    function rememberWindow(pass: Pass, window: OwnedWindow): void {
        if (window.frozenMidi) {
            const existing = pass.windows.findIndex(
                (entry) => entry.frozenMidi?.trackId === window.frozenMidi?.trackId
            );
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

    function reportCoverage(): Coverage {
        for (const pass of passes.values()) {
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
                            coverage.completionAudioTime
                )
            ) {
                coverage.through = Math.min(coverage.through, coverage.from);
                coverage.shortfall ??= 'noncanonical-frozen-window';
                break;
            }
        }
        return coverage;
    }

    function recoverMappedWindow(pool: Pass | null, fromBeat: number, toBeat: number, input: Refill): boolean {
        if (
            recoveredThisRefill ||
            !active ||
            !anchor ||
            !pool ||
            passes.get(pool.index) !== pool ||
            !isCurrent() ||
            coverage.through > Math.max(input.audioTime, context.currentTime)
        ) {
            return false;
        }
        const endBeat = Math.min(toBeat, input.transport.loopEnd);
        if (fromBeat > endBeat) {
            return false;
        }
        recoveredThisRefill = true;
        const started = monotonicTime();
        const anchorBeat = pool.index === 0 ? anchor.beat : input.transport.loopStart;
        const anchorTime = pool.index === 0 ? anchor.time : anchor.firstEnd + (pool.index - 1) * anchor.duration;
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
        const read = readProgramme(input.transport);
        prepareWindow(window, input, read.eligible);
        rememberWindow(pool, window);
        coverage.completionAudioTime = context.currentTime;
        coverage.target = Math.max(input.audioTime, coverage.completionAudioTime) + 0.35;
        coverage.shortfall ??= 'coverage-expired';
        coverage.recovery = { window, elapsedMilliseconds: monotonicTime() - started };
        return true;
    }

    function watchFrozenMidiWindow(pool: Pass | null, fromBeat: number, toBeat: number) {
        const before = new Set(pool?.sources ?? []);
        function retain(failed: boolean): void {
            if (!pool) {
                return;
            }
            const current = active && isCurrent() && passes.get(pool.index) === pool;
            for (let index = pool.sources.length - 1; index >= 0; index--) {
                const source: SourceWithFade = pool.sources[index]!;
                if (before.has(source) || !source.scheduledFrozenKey) {
                    continue;
                }
                if (failed || !current) {
                    retireSource(source);
                    pool.sources.splice(index, 1);
                    pool.frozen.delete(source.scheduledFrozenKey);
                    continue;
                }
                const clock = source.scheduledFrozenWindow;
                if (!clock || !source.scheduledTrackId) {
                    throw new Error('Frozen MIDI source has no admitted clock');
                }
                if (source.scheduledBufferId && source.buffer) {
                    buffers.set(source.scheduledBufferId, source.buffer);
                }
                pool.externalFrozenTracks.add(source.scheduledTrackId);
                if (!anchor || !currentInput) {
                    throw new Error('Frozen MIDI window has no loop anchor');
                }
                const canonicalBeat = pool.index === 0 ? anchor.beat : currentInput.transport.loopStart;
                const canonicalTime =
                    pool.index === 0 ? anchor.time : anchor.firstEnd + (pool.index - 1) * anchor.duration;
                const toCanonical = secondsBetweenBeats(
                    currentInput.changes,
                    clock.anchorBeat,
                    canonicalBeat,
                    currentInput.transport.tempo
                );
                const floorUsed = clock.floorBeat !== null && clock.floorBeat > (source.scheduledFrozenOriginBeat ?? 0);
                const noncanonical =
                    clock.anchorTime + toCanonical !== canonicalTime ||
                    (floorUsed && clock.floorAnchorTime + toCanonical !== canonicalTime);
                rememberWindow(pool, {
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
                fenceSource(source, context, pool.end + (source.compensationSeconds ?? 0));
            }
            reportCoverage();
        }
        return (emission: Promise<void>): Promise<void> =>
            emission.then(
                () => retain(false),
                (error: unknown) => {
                    retain(true);
                    throw error;
                }
            );
    }

    function refill(input: Refill): Coverage {
        currentInput = input;
        recoveredThisRefill = false;
        const { transport, changes, position, audioTime } = input;
        const started = monotonicTime();
        if (!isCurrent()) {
            reset();
            coverage.shortfall = 'retired';
            return reportCoverage();
        }
        const enabled = transport.isLooping && transport.loopEnd > transport.loopStart && position < transport.loopEnd;
        if (!enabled) {
            if (active) {
                reset();
            }
            return reportCoverage();
        }
        const nextGeometry = [
            transport.tempo,
            transport.loopStart,
            transport.loopEnd,
            changes.map((change) => [change.beat, change.tempo, change.curve]),
        ];
        if (!valuesEqual(nextGeometry, geometry)) {
            reset();
        }
        if (!anchor) {
            const duration = secondsBetweenBeats(changes, transport.loopStart, transport.loopEnd, transport.tempo);
            const firstEnd = audioTime + secondsBetweenBeats(changes, position, transport.loopEnd, transport.tempo);
            if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(firstEnd) || firstEnd <= audioTime) {
                return refuseUnrepresentable(audioTime);
            }
            anchor = { beat: position, time: audioTime, firstEnd, duration };
            preparedThrough = audioTime;
            geometry = nextGeometry;
            active = true;
            coverage = {
                from: audioTime,
                through: audioTime,
                target: audioTime,
                completionAudioTime: context.currentTime,
                windows: 0,
                shortfall: null,
            };
        }
        const currentIndex = indexAt(audioTime, false);
        if (!Number.isSafeInteger(currentIndex)) {
            return refuseUnrepresentable(audioTime);
        }
        for (const [index, pass] of passes) {
            if (
                index < currentIndex &&
                pass.sources.every(
                    (source: SourceWithFade) =>
                        Math.min(source.scheduledEndTime ?? Infinity, source.scheduledStopTime ?? Infinity) <=
                        context.currentTime
                )
            ) {
                passes.delete(index);
                dirtyPasses.delete(pass);
            }
        }
        const read = readProgramme(transport);
        const programmeChanged = !valuesEqual(programme, read.view);
        const changed =
            programmeChanged ||
            [...read.cached].some(([id, buffer]) => buffer !== null && buffers.has(id) && buffer !== buffers.get(id));
        if (changed) {
            const retained: { pass: Pass; deadline: number }[] = [];
            dirtyPasses.clear();
            for (const pass of passes.values()) {
                let deadline = Infinity;
                for (let sourceIndex = pass.sources.length - 1; sourceIndex >= 0; sourceIndex--) {
                    const source: SourceWithFade = pass.sources[sourceIndex]!;
                    deadline = Math.min(deadline, Math.max(context.currentTime, source.scheduledStartTime ?? 0));
                    if (source.scheduledStartTime === undefined || source.scheduledStartTime < context.currentTime) {
                        continue;
                    }
                    retireSource(source);
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
                dirtyPasses.set(pass, { pass, windows: [...pass.windows], next: 0 });
            }
            coverage.through = audioTime;
            preparedThrough = audioTime;
            programme = read.view;
        }
        if (programmeChanged) {
            buffers = new Map();
        }
        for (const [id, buffer] of read.cached) {
            if (buffer !== null) {
                buffers.set(id, buffer);
            }
        }
        const from = Math.max(audioTime, preparedThrough);
        coverage = {
            from: audioTime,
            through: from,
            target: audioTime + 0.35,
            completionAudioTime: context.currentTime,
            windows: 0,
            shortfall: null,
        };
        function refreshTarget(): void {
            // Preparation can span render quanta. The completed horizon is
            // measured against the actual clock, while an initial future
            // anchor remains the earliest musical content this owner admits.
            coverage.completionAudioTime = context.currentTime;
            coverage.target = Math.max(audioTime, coverage.completionAudioTime) + 0.35;
        }
        refreshTarget();
        if (!read.hasMaterial) {
            for (const pass of passes.values()) {
                retirePass(pass);
            }
            passes.clear();
            dirtyPasses.clear();
            coverage.through = coverage.target;
            preparedThrough = coverage.target;
            return reportCoverage();
        }
        for (let unit = 0; unit < 64; unit++) {
            refreshTarget();
            const dirty = dirtyPasses.values().next().value;
            if (!dirty && coverage.through >= coverage.target) {
                return reportCoverage();
            }
            if (monotonicTime() - started >= 40) {
                coverage.shortfall = 'time-budget';
                return reportCoverage();
            }
            let projected: ReturnType<typeof projectLoopAudioWindows> | null = null;
            if (!dirty) {
                projected = projectLoopAudioWindows({
                    transport,
                    changes,
                    anchorBeat: anchor.beat,
                    anchorTime: anchor.time,
                    fromTime: Math.max(coverage.through, coverage.completionAudioTime),
                    toTime: coverage.target,
                    maxWindows: 1,
                });
            }
            const window: OwnedWindow | undefined = dirty ? dirty.windows[dirty.next] : projected?.windows[0];
            if (!window) {
                if (projected?.shortfall === 'unrepresentable') {
                    return refuseUnrepresentable(audioTime);
                }
                coverage.shortfall = projected?.shortfall ?? 'unrepresentable';
                return reportCoverage();
            }
            if (!dirty && window.fromTime > coverage.through) {
                // A clock which outruns preparation has already rendered the
                // missed span. Recover from its current mapped pass directly.
                coverage.from = window.fromTime;
            }
            if (!isCurrent()) {
                reset();
                coverage.shortfall = 'retired';
                return reportCoverage();
            }
            const pass = prepareWindow(window, input, read.eligible, dirty?.pass);
            if (dirty) {
                dirtyPasses.delete(dirty.pass);
                dirty.next++;
                if (dirty.next < dirty.windows.length) {
                    dirtyPasses.set(dirty.pass, dirty);
                }
            } else {
                rememberWindow(pass, window);
            }
            if (!read.available) {
                // Keep the existing mapped recovery for ready tracks, without
                // claiming that a window missing media was fully admitted.
                coverage.shortfall = 'media-unavailable';
                refreshTarget();
                return reportCoverage();
            }
            coverage.windows++;
            if (!dirty) {
                coverage.through = window.toTime;
                preparedThrough = window.toTime;
            }
        }
        refreshTarget();
        coverage.shortfall = dirtyPasses.size > 0 || coverage.through < coverage.target ? 'pass-budget' : null;
        return reportCoverage();
    }

    const schedule = {
        refill,
        poolAt,
        fence,
        reset,
        recoverMappedWindow,
        watchFrozenMidiWindow,
        get active() {
            return active;
        },
        get coverage() {
            const snapshot: Coverage = {
                from: coverage.from,
                through: coverage.through,
                target: coverage.target,
                completionAudioTime: coverage.completionAudioTime,
                windows: coverage.windows,
                shortfall: coverage.shortfall,
            };
            if (Object.hasOwn(coverage, 'recovery')) {
                snapshot.recovery = coverage.recovery;
            }
            return snapshot;
        },
    };
    return schedule satisfies LoopAudioScheduleLifetime;
}
