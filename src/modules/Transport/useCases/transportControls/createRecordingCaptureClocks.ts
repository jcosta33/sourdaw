import { type startAudioRecording } from '#/modules/AudioEngine/useCases';

import { playheadClockRef } from '../../stores/playheadClockRef';
import { schedulerSession } from '../playheadScheduler/schedulerSession';

import { recordingLifecycle } from './recordingLifecycle';

type CaptureRelocation = { contextSeconds: number; songSeconds: number; effectiveFromContextSeconds?: number };
type CaptureClock = {
    readStart: Parameters<NonNullable<Parameters<typeof startAudioRecording>[3]>>[0] | null;
    relocation: CaptureRelocation | null;
    pendingRelocations: CaptureRelocation[];
    frozen: boolean;
    freeze: (sampleZeroContextSeconds: number) => void;
    setReader: (readStart: NonNullable<CaptureClock['readStart']>) => void;
};
type CaptureClockObserver = Parameters<typeof recordingLifecycle.registerCaptureClock>[0];

function observeSoundedTerminalSeam(context: Pick<AudioContext, 'currentTime'>, observe: CaptureClockObserver): void {
    // A planned seam sounding after the last tick is an occurrence;
    // a cancelled or still-future seam never is.
    const pending = schedulerSession.pendingSeam;
    if (pending && context.currentTime >= pending.seamAudioTime) {
        observe(pending.destinationBeat, pending.seamAudioTime, true, undefined, pending.destinationSongSeconds);
    }
    observe(playheadClockRef.beat, context.currentTime, false);
}

function freezeCaptureClock(clock: CaptureClock, sampleZeroContextSeconds: number): void {
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

/** Retain only the sounded occurrences that can contain each producer's first frame. */
export function createRecordingCaptureClocks(
    context: Pick<AudioContext, 'currentTime'>,
    songSecondsAtBeat: (beat: number) => number,
    onEnding?: () => void
) {
    const clocks = new Map<string, CaptureClock>();
    let ended = false;
    let unregisterClock = (): void => {};
    let unregisterEnding = (): void => {};

    function detachReaders(): void {
        for (const clock of clocks.values()) {
            clock.readStart = null;
        }
        unregisterClock();
    }

    function dispose(): void {
        ended = true;
        detachReaders();
        unregisterEnding();
    }

    function create(trackId: string): CaptureClock {
        const clock: CaptureClock = {
            readStart: null,
            relocation: null,
            pendingRelocations: [],
            frozen: false,
            setReader: (readStart) => {
                if (!ended && !clock.frozen && clocks.get(trackId) === clock) {
                    clock.readStart = readStart;
                }
            },
            freeze: (sampleZeroContextSeconds) => {
                freezeCaptureClock(clock, sampleZeroContextSeconds);
            },
        };
        clocks.set(trackId, clock);
        return clock;
    }

    function retainClock(
        beat: number,
        contextSeconds: number,
        relocated: boolean,
        effectiveFromContextSeconds?: number,
        songSeconds?: number
    ): void {
        if (ended) {
            return;
        }
        let relocation: CaptureRelocation | null = null;
        if (relocated) {
            relocation = { contextSeconds, songSeconds: songSeconds ?? songSecondsAtBeat(beat) };
            if (effectiveFromContextSeconds !== undefined) {
                relocation.effectiveFromContextSeconds = effectiveFromContextSeconds;
            }
        }
        let waitingForFrame = false;
        for (const clock of clocks.values()) {
            if (clock.frozen) {
                continue;
            }
            retainCaptureRelocation(clock, relocation);
            waitingForFrame ||= !clock.frozen;
        }
        if (!waitingForFrame) {
            unregisterClock();
        }
    }

    return {
        create,
        get size() {
            return clocks.size;
        },
        remove: (trackId: string): void => {
            const clock = clocks.get(trackId);
            if (clock) {
                clock.readStart = null;
            }
            clocks.delete(trackId);
            if (clocks.size === 0) {
                dispose();
            }
        },
        dispose,
        register: (): void => {
            if (ended) {
                return;
            }
            unregisterClock = recordingLifecycle.registerCaptureClock(retainClock);
            unregisterEnding = recordingLifecycle.registerEnding(() => {
                observeSoundedTerminalSeam(context, retainClock);
                onEnding?.();
                dispose();
            });
        },
    };
}
