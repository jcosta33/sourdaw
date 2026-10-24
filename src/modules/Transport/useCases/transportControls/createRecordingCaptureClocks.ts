import { admitRecordingCaptureClock } from '#/modules/Arrangement/useCases';
import { createNativeRecordingCaptureClock, type startAudioRecording } from '#/modules/AudioEngine/useCases';
import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { playheadClockRef } from '../../stores/playheadClockRef';
import { nativeRecordingEntry } from '../playheadScheduler/nativeRecordingEntry';
import { schedulerSession } from '../playheadScheduler/schedulerSession';

import {
    createNativeRecordingCaptureHistory,
    type NativeCaptureBoundary,
    type NativeCaptureSnapshot,
} from './nativeRecordingCaptureHistory';
import { recordingLifecycle } from './recordingLifecycle';

type CaptureRelocation = { contextSeconds: number; songSeconds: number; effectiveFromContextSeconds?: number };
type CaptureClock = {
    bind: (clipId: string) => void;
    admitFirst: (sampleZeroContextSeconds: number, sourceDurationSeconds?: number) => void;
    nativeHistory: ReturnType<typeof createNativeRecordingCaptureHistory>;
    requestedContextSeconds: number;
    nativePending: boolean;
    nativeOwned: boolean;
    admissionContextSeconds: number | null;
    sampleZeroContextSeconds: number | null;
    latencySeconds: number;
    readStart: Parameters<NonNullable<Parameters<typeof startAudioRecording>[3]>>[0] | null;
    relocation: CaptureRelocation | null;
    pendingRelocations: CaptureRelocation[];
    frozen: boolean;
    freeze: (sampleZeroContextSeconds: number, sourceDurationSeconds?: number) => void;
    setReader: (readStart: NonNullable<CaptureClock['readStart']>) => void;
};
type CaptureClockObserver = Parameters<typeof recordingLifecycle.registerCaptureClock>[0];

function observeSoundedTerminalSeam(context: Pick<AudioContext, 'currentTime'>, observe: CaptureClockObserver): void {
    if (schedulerSession.observeNativeRecordingClock?.()) {
        return;
    }
    // A planned seam sounding after the last tick is an occurrence;
    // a cancelled or still-future seam never is.
    const pending = schedulerSession.pendingSeam;
    if (pending && context.currentTime >= pending.seamAudioTime) {
        observe(pending.destinationBeat, pending.seamAudioTime, true, undefined, pending.destinationSongSeconds);
    }
    observe(playheadClockRef.beat, context.currentTime, false);
}

function freezeCaptureClock(
    clock: CaptureClock,
    sampleZeroContextSeconds: number,
    sourceDurationSeconds?: number
): void {
    clock.sampleZeroContextSeconds = sampleZeroContextSeconds;
    clock.admitFirst(sampleZeroContextSeconds, sourceDurationSeconds);
    for (const pending of clock.pendingRelocations) {
        if (
            (pending.effectiveFromContextSeconds ?? pending.contextSeconds) <= sampleZeroContextSeconds &&
            (!clock.relocation || pending.contextSeconds >= clock.relocation.contextSeconds)
        ) {
            clock.relocation = pending;
        }
    }
    clock.pendingRelocations.length = 0;
    clock.readStart = null;
    clock.frozen = true;
}

function retainCaptureRelocation(clock: CaptureClock, relocation: CaptureRelocation | null): void {
    const start = clock.readStart?.();
    if (start?.status === 'captured') {
        clock.admitFirst(start.contextSeconds);
        if (clock.nativePending) {
            return;
        }
        if (
            relocation &&
            (relocation.effectiveFromContextSeconds ?? relocation.contextSeconds) <= start.contextSeconds
        ) {
            clock.relocation = relocation;
        }
        clock.freeze(start.contextSeconds);
        return;
    }
    if (!relocation) {
        return;
    }
    if (start?.status === 'retry' || (!clock.readStart && relocation.effectiveFromContextSeconds !== undefined)) {
        // An unread frame may precede the edit even when its placement
        // anchor is earlier. Admit the epoch only against sample zero.
        // A torn first publication can span several sounded seams and edits.
        // Keep every candidate until sample zero selects its own latest epoch.
        // Equal anchors can have different effective instants; retain their observed order.
        const latest = clock.pendingRelocations.at(-1);
        if (!latest || relocation.contextSeconds >= latest.contextSeconds) {
            clock.pendingRelocations.push(relocation);
        }
        return;
    }
    if (!clock.readStart || start?.status === 'pending') {
        // Before reader admission, as with a stable empty publication,
        // sample zero is still ahead of this sounded occurrence.
        clock.relocation = relocation;
        clock.pendingRelocations.length = 0;
    }
}

type CaptureEnding = ReturnType<Parameters<typeof admitRecordingCaptureClock>[3]>;
type CaptureContext = Pick<AudioContext, 'currentTime'> & Partial<Pick<AudioContext, 'getOutputTimestamp' | 'state'>>;

/** Each group and input retain their own admission, ending, and producer history. */
class RecordingCaptureClocks {
    private readonly rootIdentity = captureProjectRootIdentity();
    private readonly clocks = new Map<string, CaptureClock>();
    readonly nativeClock = createNativeRecordingCaptureClock();
    private ended = false;
    private unregisterClock = (): void => {};
    private unregisterEnding = (): void => {};
    private unregisterNative = (): void => {};
    private readonly endings = new Map<CaptureClock, CaptureEnding>();
    private readonly boundClips = new Map<CaptureClock, string>();

    constructor(
        private readonly context: CaptureContext,
        private readonly songSecondsAtBeat: (beat: number) => number,
        private readonly onEnding?: () => void
    ) {}

    get size() {
        return this.clocks.size;
    }

    readonly isOwnerCurrent = (): boolean => {
        if (captureProjectRootIdentity() === this.rootIdentity) {
            return true;
        }
        this.dispose();
        return false;
    };

    private isActiveObserver(): boolean {
        return this.isOwnerCurrent() && !this.ended;
    }

    private endingFor(clock: CaptureClock): CaptureEnding {
        const carrier = this.nativeClock.read(this.context);
        const snapshot = this.nativeClock.last;
        if (carrier.carrier === 'browser' || !snapshot) {
            return undefined;
        }
        let timestamp: AudioTimestamp | undefined;
        try {
            timestamp = this.context.getOutputTimestamp?.();
        } catch {
            // A temporarily missing platform clock cannot replace the owner's
            // retained native date with a browser anchor.
        }
        let audibleNow = snapshot.audibleContextSeconds;
        if (timestamp?.contextTime && timestamp.performanceTime) {
            audibleNow = timestamp.contextTime + (performance.now() / 1000 - timestamp.performanceTime / 1000);
        }
        const contextSeconds = Math.min(this.context.currentTime - clock.latencySeconds, audibleNow);
        const terminalEntry = clock.nativeHistory.entryAt(contextSeconds + clock.latencySeconds);
        if (!terminalEntry) {
            clock.nativeHistory.refuseProjection();
            return undefined;
        }
        return {
            contextSeconds,
            beatAtContextSeconds: (seconds: number) => {
                const entry = clock.nativeHistory.entryAt(Math.min(seconds, contextSeconds) + clock.latencySeconds);
                if (!entry) {
                    // A provisional ending may still close while its full PCM
                    // must be recovered. It cannot authorize final placement.
                    clock.nativeHistory.refuseProjection();
                    return terminalEntry.beat;
                }
                return entry.beat;
            },
        };
    }

    readonly dispose = (): void => {
        this.ended = true;
        for (const clock of this.clocks.values()) {
            clock.readStart = null;
        }
        this.unregisterClock();
        this.unregisterNative();
        this.unregisterEnding();
    };

    create(trackId: string, latencySeconds = 0): CaptureClock {
        let initial: ReturnType<typeof this.nativeClock.read> = { carrier: 'native', status: 'unavailable' };
        if (this.isOwnerCurrent()) {
            initial = this.nativeClock.read(this.context);
        }
        const nativeHistory = createNativeRecordingCaptureHistory(
            trackId,
            this.nativeClock.admission ?? null,
            latencySeconds,
            () => this.endings.get(clock) ?? this.endingFor(clock)
        );
        let admissionContextSeconds: number | null = null;
        if (
            initial.carrier === 'native' &&
            initial.status === 'available' &&
            initial.snapshot.forwardAuthorized !== false
        ) {
            nativeHistory.observe(initial.snapshot);
            admissionContextSeconds = nativeRecordingEntry(initial.snapshot).contextSeconds;
        }
        const clock: CaptureClock = {
            nativeHistory,
            requestedContextSeconds: this.context.currentTime,
            nativeOwned: initial.carrier === 'native',
            nativePending:
                initial.carrier === 'native' &&
                (initial.status === 'unavailable' || initial.snapshot.forwardAuthorized === false),
            admissionContextSeconds,
            sampleZeroContextSeconds: null,
            admitFirst: (sampleZero, duration) => this.admitFirst(clock, sampleZero, duration),
            bind: (clipId) => this.bind(clock, clipId),
            latencySeconds,
            readStart: null,
            relocation: null,
            pendingRelocations: [],
            frozen: false,
            setReader: (readStart) => {
                if (this.isOwnerCurrent() && !this.ended && !clock.frozen && this.clocks.get(trackId) === clock) {
                    clock.readStart = readStart;
                }
            },
            freeze: (sampleZero, duration) => {
                if (this.isOwnerCurrent()) {
                    freezeCaptureClock(clock, sampleZero, duration);
                }
            },
        };
        this.clocks.set(trackId, clock);
        return clock;
    }

    private admitFirst(clock: CaptureClock, sampleZero: number, duration?: number): void {
        if (!this.isOwnerCurrent()) {
            return;
        }
        const entry = clock.nativeHistory.materialize(sampleZero, duration);
        if (!entry) {
            return;
        }
        clock.relocation = { contextSeconds: entry.contextSeconds, songSeconds: entry.songSeconds };
        const clipId = this.boundClips.get(clock);
        if (clipId) {
            admitRecordingCaptureClock(
                clipId,
                entry.beat,
                entry.contextSeconds,
                () => this.endings.get(clock) ?? this.endingFor(clock)
            );
            clock.nativePending = false;
        }
    }

    private bind(clock: CaptureClock, clipId: string): void {
        if (!this.isOwnerCurrent()) {
            return;
        }
        this.boundClips.set(clock, clipId);
        clock.nativeHistory.bind(clipId, this.context.currentTime);
        const read = this.nativeClock.read(this.context);
        if (read.carrier === 'native') {
            if (read.status === 'available') {
                clock.nativeHistory.observe(read.snapshot);
            }
            const first = clock.readStart?.();
            const raw = clock.sampleZeroContextSeconds ?? (first?.status === 'captured' ? first.contextSeconds : null);
            if (raw !== null) {
                clock.admitFirst(raw);
            }
            let entry: ReturnType<typeof nativeRecordingEntry> | null = null;
            if (read.status === 'available' && !clock.nativePending) {
                entry = nativeRecordingEntry(read.snapshot);
            }
            if (read.status === 'available') {
                clock.admissionContextSeconds = read.snapshot.audibleContextSeconds;
            }
            admitRecordingCaptureClock(
                clipId,
                entry?.beat,
                entry?.contextSeconds,
                () => this.endings.get(clock) ?? this.endingFor(clock)
            );
        }
        const first = clock.readStart?.();
        if (first?.status === 'captured') {
            clock.admitFirst(first.contextSeconds);
        }
    }

    private retainInputObservations(
        clock: CaptureClock,
        nativeOutput: boolean,
        nativeSnapshot?: NativeCaptureSnapshot,
        nativeBoundary?: NativeCaptureBoundary
    ): void {
        if (!nativeOutput) {
            clock.nativeOwned = false;
        }
        if (nativeSnapshot) {
            clock.nativeOwned = true;
            clock.nativeHistory.observe(nativeSnapshot);
        }
        if (nativeBoundary) {
            const first = clock.readStart?.();
            const raw = clock.sampleZeroContextSeconds ?? (first?.status === 'captured' ? first.contextSeconds : null);
            clock.nativeHistory.retain(nativeBoundary, raw);
        }
    }

    private readonly retainClock: CaptureClockObserver = (
        beat,
        contextSeconds,
        relocated,
        effectiveFromContextSeconds,
        songSeconds,
        nativeOutput = false,
        nativeBoundary?: NativeCaptureBoundary,
        nativeSnapshot?: NativeCaptureSnapshot
    ): void => {
        if (!this.isActiveObserver()) {
            return;
        }
        let relocation: CaptureRelocation | null = null;
        if (relocated) {
            relocation = { contextSeconds, songSeconds: songSeconds ?? this.songSecondsAtBeat(beat) };
            if (effectiveFromContextSeconds !== undefined) {
                relocation.effectiveFromContextSeconds = effectiveFromContextSeconds;
            }
        }
        for (const clock of this.clocks.values()) {
            this.retainInputObservations(clock, nativeOutput, nativeSnapshot, nativeBoundary);
            const clipId = this.boundClips.get(clock);
            if (nativeOutput && relocated && clipId && !clock.nativePending) {
                admitRecordingCaptureClock(
                    clipId,
                    beat,
                    contextSeconds,
                    () => this.endings.get(clock) ?? this.endingFor(clock)
                );
            }
            if (clock.frozen) {
                continue;
            }
            let ownedRelocation = relocation;
            if (relocation && nativeOutput) {
                ownedRelocation = {
                    ...relocation,
                    effectiveFromContextSeconds:
                        (relocation.effectiveFromContextSeconds ?? relocation.contextSeconds) + clock.latencySeconds,
                };
            }
            retainCaptureRelocation(clock, ownedRelocation);
        }
        // A browser-admitted owner may still hand over to native playback.
        // Its observer remains owned until the synchronous ending detaches it.
    };

    private readonly readNative = (): ReturnType<ReturnType<typeof createNativeRecordingCaptureClock>['read']> => {
        if (!this.isOwnerCurrent()) {
            return { carrier: 'native', status: 'unavailable' };
        }
        const read = this.nativeClock.read(this.context);
        if (read.carrier === 'browser') {
            for (const clock of this.clocks.values()) {
                clock.nativeOwned = false;
                clock.nativePending = false;
            }
        }
        if (read.carrier === 'native' && read.status === 'available') {
            for (const clock of this.clocks.values()) {
                clock.nativeOwned = true;
                clock.nativeHistory.observe(read.snapshot);
                const first = clock.readStart?.();
                if (first?.status === 'captured') {
                    clock.admitFirst(first.contextSeconds);
                }
            }
        }
        return read;
    };

    private readonly readSourceStart = (): number | null => {
        if (!this.isOwnerCurrent()) {
            return null;
        }
        const starts = Array.from(this.clocks.values(), (clock) => {
            const first = clock.readStart?.();
            const raw = clock.sampleZeroContextSeconds ?? (first?.status === 'captured' ? first.contextSeconds : null);
            if (raw === null) {
                return Math.min(
                    clock.requestedContextSeconds - clock.latencySeconds,
                    clock.admissionContextSeconds ?? Infinity
                );
            }
            return Math.min(raw - clock.latencySeconds, clock.admissionContextSeconds ?? Infinity);
        });
        if (starts.length > 0) {
            return Math.min(...starts);
        }
        return null;
    };

    private readonly finish = (): void => {
        if (!this.isOwnerCurrent()) {
            return;
        }
        observeSoundedTerminalSeam(this.context, this.retainClock);
        for (const clock of this.clocks.values()) {
            this.endings.set(clock, this.endingFor(clock));
        }
        const terminal = this.nativeClock.read(this.context);
        if (
            this.nativeClock.last &&
            terminal.carrier === 'native' &&
            (terminal.status === 'unavailable' || terminal.snapshot.quality === 'degraded')
        ) {
            notifyUser(
                'Recording timing could not be verified. Your audio was kept; check its alignment before playback.',
                'warning'
            );
        }
        this.onEnding?.();
        this.dispose();
    };

    remove(trackId: string): void {
        const clock = this.clocks.get(trackId);
        if (clock) {
            clock.readStart = null;
        }
        this.clocks.delete(trackId);
        if (this.clocks.size === 0) {
            this.dispose();
        }
    }

    register(): void {
        if (!this.isOwnerCurrent() || this.ended) {
            return;
        }
        this.unregisterClock = recordingLifecycle.registerCaptureClock(this.retainClock);
        this.unregisterNative = recordingLifecycle.registerNativeCaptureClock(this.readNative, this.readSourceStart);
        this.unregisterEnding = recordingLifecycle.registerEnding(this.finish);
    }
}

/** Retain only the sounded occurrences that can contain each producer's first frame. */
export function createRecordingCaptureClocks(
    context: CaptureContext,
    songSecondsAtBeat: (beat: number) => number,
    onEnding?: () => void
) {
    return new RecordingCaptureClocks(context, songSecondsAtBeat, onEnding);
}
