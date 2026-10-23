import { activeRecordingRef } from '#/modules/Arrangement/stores';
import { observeRecordingPassEntry } from '#/modules/Arrangement/useCases';
import { type createNativeRecordingCaptureClock } from '#/modules/AudioEngine/useCases';

import { type TransportState } from '../../models/TransportState';
import { type NativeCaptureBoundary } from '../transportControls/nativeRecordingCaptureHistory';
import { recordingLifecycle } from '../transportControls/recordingLifecycle';

import { nativeRecordingEntry } from './nativeRecordingEntry';

type Read = ReturnType<ReturnType<typeof createNativeRecordingCaptureClock>['read']>;
type Snapshot = Extract<Read, { status: 'available' }>['snapshot'];

function wrapBoundary(snapshot: Snapshot, time: number, wrap: number, planned: boolean): NativeCaptureBoundary {
    return {
        key: `${snapshot.clockIdentity}:${snapshot.admission.serial}:wrap:${wrap}`,
        contextSeconds: time,
        outgoing: snapshot,
        incoming: snapshot,
        endBeat: snapshot.geometry.loopEnd,
        nextPassStartBeat: snapshot.geometry.loopStart,
        planned,
    };
}

function publish(boundary: NativeCaptureBoundary): void {
    const geometry = boundary.incoming.geometry;
    recordingLifecycle.observeCaptureClock(
        boundary.nextPassStartBeat,
        boundary.contextSeconds,
        !boundary.planned,
        undefined,
        geometry.secondsAtBeat(boundary.nextPassStartBeat),
        true,
        boundary
    );
    if (!boundary.planned) {
        observeRecordingPassEntry(boundary.nextPassStartBeat, boundary.contextSeconds, true);
    }
}

/** Native dates announce occurrences; each input owns their eventual materialization. */
class NativeRecordingPassClock {
    private native = false;
    private previous: Snapshot | null = null;
    private forecast: NativeCaptureBoundary | null = null;
    private readonly rendered: NativeCaptureBoundary[] = [];
    private owner = '';
    private firstDatedPass = true;

    get isNative() {
        return this.native;
    }

    private confirmWraps(snapshot: Snapshot): void {
        const geometry = snapshot.geometry;
        const start = geometry.secondsAtBeat(geometry.loopStart);
        const duration = geometry.secondsAtBeat(geometry.loopEnd) - start;
        if (!geometry.isLooping || duration <= 0) {
            return;
        }
        const lastTime = snapshot.contextSeconds - (snapshot.songSeconds - start);
        const sourceStart = recordingLifecycle.readNativeCaptureSourceStart();
        let wraps = 0;
        if (this.previous) {
            wraps = snapshot.loopWraps - this.previous.loopWraps;
        }
        if (sourceStart !== null && this.firstDatedPass) {
            wraps = Math.min(snapshot.loopWraps, Math.max(0, Math.ceil((lastTime - sourceStart) / duration)));
            this.firstDatedPass = false;
        }
        for (let index = Math.max(0, wraps) - 1; index >= 0; index--) {
            const boundary = wrapBoundary(snapshot, lastTime - index * duration, snapshot.loopWraps - index, false);
            if (this.forecast?.key === boundary.key) {
                this.forecast = null;
            }
            this.confirm(boundary, snapshot.audibleContextSeconds);
        }
    }

    private confirm(boundary: NativeCaptureBoundary, audibleContextSeconds: number): void {
        if (boundary.contextSeconds <= audibleContextSeconds) {
            this.sound(boundary);
        } else if (!this.rendered.some((candidate) => candidate.key === boundary.key)) {
            // Keep the existing provisional end while rendering is ahead. The
            // confirmed history still waits for the output edge to sound it.
            this.forecast = { ...boundary, planned: true };
            publish(this.forecast);
            this.rendered.push(boundary);
            this.rendered.sort((left, right) => left.contextSeconds - right.contextSeconds);
        }
    }

    private sound(boundary: NativeCaptureBoundary): void {
        if (this.forecast?.key === boundary.key) {
            this.forecast = null;
        }
        publish(boundary);
    }

    private soundRendered(snapshot: Snapshot): void {
        while (this.rendered[0] && this.rendered[0].contextSeconds <= snapshot.audibleContextSeconds) {
            this.sound(this.rendered.shift()!);
        }
    }

    private cancelForecast(beat: number, contextSeconds: number): void {
        if (!this.forecast) {
            return;
        }
        observeRecordingPassEntry(beat, contextSeconds, false, true);
        recordingLifecycle.observeCaptureClock(beat, contextSeconds, false, undefined, undefined, true, {
            ...this.forecast,
            cancelled: true,
        });
        this.forecast = null;
    }

    private forecastNext(snapshot: Snapshot, ending: boolean): void {
        const geometry = snapshot.geometry;
        if (
            this.forecast ||
            !geometry.isLooping ||
            ending ||
            !this.owner ||
            recordingLifecycle.readNativeCaptureSourceStart() === null
        ) {
            return;
        }
        const time = snapshot.contextSeconds + geometry.secondsAtBeat(geometry.loopEnd) - snapshot.songSeconds;
        if (time > snapshot.audibleContextSeconds && time <= snapshot.audibleContextSeconds + 0.1) {
            this.forecast = wrapBoundary(snapshot, time, snapshot.loopWraps + 1, true);
            publish(this.forecast);
        }
    }

    private relocate(snapshot: Snapshot): void {
        const previous = this.previous;
        if (!previous || !snapshot.admission.located) {
            return;
        }
        this.confirm(
            {
                key: `${snapshot.clockIdentity}:${snapshot.admission.serial}:locate`,
                contextSeconds: snapshot.contextSeconds,
                outgoing: previous,
                incoming: snapshot,
                endBeat: previous.geometry.beatAtSeconds(
                    previous.songSeconds + snapshot.contextSeconds - previous.contextSeconds
                ),
                nextPassStartBeat: snapshot.geometry.beatAtSeconds(snapshot.songSeconds),
                planned: false,
            },
            snapshot.audibleContextSeconds
        );
    }

    observe(state: TransportState, read: Read, ending = false): boolean {
        if (read.carrier === 'browser') {
            this.cancelForecast(state.playheadPosition, (this.forecast?.contextSeconds ?? 0) - 1e-8);
            this.previous = null;
            this.rendered.length = 0;
            this.native = false;
            return false;
        }
        this.native = true;
        if (read.status === 'unavailable') {
            return true;
        }
        const snapshot = read.snapshot;
        const entry = nativeRecordingEntry(snapshot);
        const nextOwner = activeRecordingRef.current.join(':');
        const changed = this.previous !== null && this.previous.admission.serial !== snapshot.admission.serial;
        if (!this.previous || changed) {
            if (!this.previous) {
                observeRecordingPassEntry(entry.beat, snapshot.audibleContextSeconds, false, true);
            }
            this.cancelForecast(entry.beat, snapshot.audibleContextSeconds);
            recordingLifecycle.observeCaptureClock(
                entry.beat,
                entry.contextSeconds,
                true,
                snapshot.contextSeconds,
                entry.songSeconds,
                true
            );
        }
        if (this.owner !== nextOwner) {
            this.owner = nextOwner;
            this.firstDatedPass = true;
        }
        this.soundRendered(snapshot);
        if (changed) {
            this.relocate(snapshot);
        } else {
            this.confirmWraps(snapshot);
        }
        this.soundRendered(snapshot);
        this.forecastNext(snapshot, ending);
        observeRecordingPassEntry(entry.beat, entry.contextSeconds, changed);
        recordingLifecycle.observeCaptureClock(entry.beat, entry.contextSeconds, false);
        this.previous = snapshot;
        return true;
    }
}

export function createNativeRecordingPassClock() {
    return new NativeRecordingPassClock();
}
