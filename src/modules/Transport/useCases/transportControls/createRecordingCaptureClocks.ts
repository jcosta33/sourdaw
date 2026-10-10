import { type startAudioRecording } from '#/modules/AudioEngine/useCases';

import { playheadClockRef } from '../../stores/playheadClockRef';
import { schedulerSession } from '../playheadScheduler/schedulerSession';

import { recordingLifecycle } from './recordingLifecycle';

type CaptureRelocation = { contextSeconds: number; songSeconds: number };
type CaptureClock = {
    readStart: Parameters<NonNullable<Parameters<typeof startAudioRecording>[3]>>[0] | null;
    relocation: CaptureRelocation | null;
    pendingRelocation: CaptureRelocation | null;
    frozen: boolean;
    freeze: (sampleZeroContextSeconds: number) => void;
    setReader: (readStart: NonNullable<CaptureClock['readStart']>) => void;
};

function freezeCaptureClock(clock: CaptureClock, sampleZeroContextSeconds: number): void {
    const pending = clock.pendingRelocation;
    if (
        pending &&
        pending.contextSeconds <= sampleZeroContextSeconds &&
        (!clock.relocation || pending.contextSeconds > clock.relocation.contextSeconds)
    ) {
        clock.relocation = pending;
    }
    clock.pendingRelocation = null;
    clock.readStart = null;
    clock.frozen = true;
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
            pendingRelocation: null,
            frozen: false,
            setReader: (readStart) => {
                if (!ended && clocks.get(trackId) === clock) {
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

    function retainClock(beat: number, contextSeconds: number, relocated: boolean): void {
        if (ended) {
            return;
        }
        const relocation = relocated ? { contextSeconds, songSeconds: songSecondsAtBeat(beat) } : null;
        let waitingForFrame = false;
        for (const clock of clocks.values()) {
            if (clock.frozen) {
                continue;
            }
            const start = clock.readStart?.();
            if (start?.status === 'captured') {
                if (relocation && relocation.contextSeconds <= start.contextSeconds) {
                    clock.relocation = relocation;
                }
                clock.freeze(start.contextSeconds);
            } else if ((!clock.readStart || start?.status === 'pending') && relocation) {
                // Before reader admission, as with a stable empty publication,
                // sample zero is still ahead of this sounded occurrence.
                clock.relocation = relocation;
                clock.pendingRelocation = null;
            } else if (start?.status === 'retry' && relocation) {
                // A block in flight across the seam has two possible occurrences.
                clock.pendingRelocation ??= relocation;
            }
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
                // A planned seam sounding after the last tick is an occurrence;
                // a cancelled or still-future seam never is.
                const pending = schedulerSession.pendingSeam;
                if (pending && context.currentTime >= pending.seamAudioTime) {
                    retainClock(pending.destinationBeat, pending.seamAudioTime, true);
                }
                retainClock(playheadClockRef.beat, context.currentTime, false);
                onEnding?.();
                dispose();
            });
        },
    };
}
