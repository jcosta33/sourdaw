import { trackStore } from '#/modules/Arrangement/stores';
import { admitRecordingCaptureClock } from '#/modules/Arrangement/useCases';
import { type createNativeRecordingCaptureClock } from '#/modules/AudioEngine/useCases';

import { nativeRecordingEntry } from '../playheadScheduler/nativeRecordingEntry';

import { redateNativePunchEnding } from './redateNativePunchEnding';

type NativeClock = ReturnType<typeof createNativeRecordingCaptureClock>;
export type NativeCaptureSnapshot = NonNullable<NativeClock['last']>;
export type NativeCaptureBoundary = Readonly<{
    key: string;
    contextSeconds: number;
    outgoing: NativeCaptureSnapshot;
    incoming: NativeCaptureSnapshot;
    endBeat: number;
    nextPassStartBeat: number;
    planned: boolean;
    cancelled?: true;
}>;
type Ending = Parameters<typeof admitRecordingCaptureClock>[3];
type Entry = ReturnType<typeof nativeRecordingEntry>;
type Epoch = { first: NativeCaptureSnapshot; last: NativeCaptureSnapshot };

function incomingAnchor(boundary: NativeCaptureBoundary): NativeCaptureSnapshot {
    return {
        ...boundary.incoming,
        contextSeconds: boundary.contextSeconds,
        songSeconds: boundary.incoming.geometry.secondsAtBeat(boundary.nextPassStartBeat),
    };
}

/** Confirmed native occurrences stay with the input that captured their PCM. */
class NativeRecordingCaptureHistory {
    private projectionKnown = false;
    private historyComplete = true;
    private endingRefused = false;
    private automaticEnding: { outBeat: number; contextSeconds: number; anchor: NativeCaptureSnapshot } | null = null;
    private automaticEndingFrozen = false;
    private lastObservation: NativeCaptureSnapshot | null = null;
    private readonly epochs = new Map<string, Epoch>();
    private readonly boundaries = new Map<string, NativeCaptureBoundary>();
    private readonly staged = new Set<string>();
    private owner: { clipId: string; originalTakeId: string; boundAtContextSeconds: number } | null = null;

    constructor(
        private readonly trackId: string,
        private readonly initialAdmission: NativeClock['admission'],
        private readonly latencySeconds: number,
        private readonly ending: Ending
    ) {}

    observe(snapshot: NativeCaptureSnapshot): void {
        const observations = snapshot.observations ?? [snapshot];
        const points = observations.toSorted((left, right) => left.contextSeconds - right.contextSeconds);
        for (const point of points) {
            if (point.forwardAuthorized === false) {
                continue;
            }
            const previous = this.lastObservation;
            if (!previous || point.contextSeconds > previous.contextSeconds) {
                if (
                    previous &&
                    previous.clockIdentity === point.clockIdentity &&
                    previous.admission.serial !== point.admission.serial &&
                    point.loopWraps > previous.loopWraps
                ) {
                    // The counter proves a wrap, but neither geometry dates it:
                    // the maps/locate may have drained on either side of it.
                    this.historyComplete = false;
                }
                this.lastObservation = point;
            }
            const key = `${point.clockIdentity}:${point.admission.serial}`;
            const epoch = this.epochs.get(key);
            if (epoch) {
                if (point.contextSeconds < epoch.first.contextSeconds) {
                    epoch.first = point;
                }
                if (point.contextSeconds >= epoch.last.contextSeconds) {
                    epoch.last = point;
                }
            } else {
                this.epochs.set(key, { first: point, last: point });
            }
        }
        this.projectionKnown = snapshot.forwardAuthorized !== false;
    }

    isProjectionKnown(): boolean {
        return this.projectionKnown && this.historyComplete && !this.endingRefused;
    }

    projectionState(): 'pending' | 'known' | 'refused' {
        if (!this.historyComplete || this.endingRefused) {
            return 'refused';
        }
        return this.projectionKnown ? 'known' : 'pending';
    }

    readAutomaticEnding(outBeat: number) {
        if (this.projectionState() === 'refused') {
            return { status: 'refused' as const };
        }
        if (!this.automaticEnding) {
            const anchors = Array.from(this.epochs.values(), (epoch) => epoch.first).toSorted(
                (left, right) => left.contextSeconds - right.contextSeconds
            );
            for (const anchor of anchors) {
                const entry = nativeRecordingEntry(anchor);
                const geometry = anchor.geometry;
                if (
                    entry.beat <= outBeat &&
                    (!geometry.isLooping || entry.beat >= geometry.loopEnd || outBeat <= geometry.loopEnd)
                ) {
                    this.automaticEnding = {
                        outBeat,
                        contextSeconds: entry.contextSeconds + geometry.secondsAtBeat(outBeat) - entry.songSeconds,
                        anchor,
                    };
                    break;
                }
            }
        }
        if (this.automaticEnding && !this.automaticEndingFrozen && this.lastObservation) {
            for (const epoch of this.epochs.values()) {
                this.automaticEnding = redateNativePunchEnding(this.automaticEnding, {
                    ...epoch.first,
                    audibleContextSeconds: this.lastObservation.audibleContextSeconds,
                });
            }
        }
        const target = this.automaticEnding;
        if (!target || this.projectionState() !== 'known') {
            return { status: 'pending' as const };
        }
        const entry = this.entryAt(target.contextSeconds + this.latencySeconds);
        if (!entry) {
            return { status: 'pending' as const };
        }
        const geometry = target.anchor.geometry;
        const outSeconds = geometry.secondsAtBeat(target.outBeat);
        return {
            status: 'dated' as const,
            ending: {
                contextSeconds: target.contextSeconds,
                beatAtContextSeconds: (seconds: number) =>
                    geometry.beatAtSeconds(outSeconds + seconds - target.contextSeconds),
            },
        };
    }

    refuseProjection(reason: 'unavailable' | 'ending' = 'unavailable'): void {
        this.projectionKnown = false;
        if (reason === 'ending') {
            this.endingRefused = true;
        }
    }

    freezeAutomaticEnding(): void {
        this.automaticEndingFrozen = true;
    }

    bind(clipId: string, boundAtContextSeconds: number): void {
        const originalTakeId = admitRecordingCaptureClock(clipId, undefined, undefined, this.ending);
        if (originalTakeId) {
            this.owner = { clipId, originalTakeId, boundAtContextSeconds };
        }
    }

    isOwnerCurrent(): boolean {
        if (
            !this.owner ||
            !trackStore.value?.tracks.some(
                (track) => track.id === this.trackId && track.clips.some((clip) => clip.id === this.owner?.clipId)
            )
        ) {
            return false;
        }
        return (
            admitRecordingCaptureClock(this.owner.clipId, undefined, undefined, this.ending) ===
            this.owner.originalTakeId
        );
    }

    entryAt(sampleZeroContextSeconds: number): Entry | null {
        const target = sampleZeroContextSeconds - this.latencySeconds;
        const anchors: NativeCaptureSnapshot[] = [];
        for (const epoch of this.epochs.values()) {
            for (const snapshot of [epoch.first, epoch.last]) {
                const authenticInitial =
                    this.initialAdmission?.serial === snapshot.admission.serial &&
                    this.initialAdmission.clockIdentity === snapshot.clockIdentity;
                if (snapshot.contextSeconds <= target || authenticInitial) {
                    anchors.push(snapshot);
                }
            }
        }
        for (const boundary of this.boundaries.values()) {
            if (boundary.contextSeconds <= target) {
                anchors.push(incomingAnchor(boundary));
            }
        }
        // Prefer the latest actual occurrence at/before sample zero. A first
        // dated callback may project backwards only under the admission the
        // owner already held, never under a later edited/located epoch.
        const preceding = anchors
            .filter((anchor) => anchor.contextSeconds <= target)
            .sort((left, right) => right.contextSeconds - left.contextSeconds)[0];
        const anchor = preceding ?? anchors.sort((left, right) => left.contextSeconds - right.contextSeconds)[0];
        if (!anchor) {
            return null;
        }
        if (target > anchor.contextSeconds) {
            const geometry = anchor.geometry;
            const end = geometry.secondsAtBeat(geometry.loopEnd);
            const crossesUnwitnessedSeam =
                geometry.isLooping &&
                anchor.songSeconds < end &&
                anchor.songSeconds + target - anchor.contextSeconds >= end;
            if (!this.projectionKnown || crossesUnwitnessedSeam) {
                return null;
            }
        }
        return nativeRecordingEntry(anchor, target, this.witnessedWrapsAfter(anchor, target));
    }

    private witnessedWrapsAfter(anchor: NativeCaptureSnapshot, target: number): number {
        let wraps = 0;
        for (const boundary of this.boundaries.values()) {
            if (
                boundary.outgoing.clockIdentity === anchor.clockIdentity &&
                boundary.outgoing.admission.serial === anchor.admission.serial &&
                boundary.contextSeconds > target &&
                boundary.contextSeconds <= anchor.contextSeconds &&
                boundary.key.includes(':wrap:')
            ) {
                wraps++;
            }
        }
        return wraps;
    }

    retain(boundary: NativeCaptureBoundary, sampleZeroContextSeconds: number | null): void {
        if (boundary.cancelled) {
            this.staged.delete(boundary.key);
            return;
        }
        this.observe(boundary.outgoing);
        this.observe(boundary.incoming);
        if (!boundary.planned && !this.boundaries.has(boundary.key)) {
            this.boundaries.set(boundary.key, boundary);
        }
        if (sampleZeroContextSeconds !== null) {
            this.materialize(sampleZeroContextSeconds);
            if (boundary.planned) {
                this.stage(boundary, sampleZeroContextSeconds - this.latencySeconds, Infinity);
            }
        }
    }

    materialize(sampleZeroContextSeconds: number, sourceDurationSeconds = Infinity): Entry | null {
        const entry = this.entryAt(sampleZeroContextSeconds);
        if (!this.owner) {
            return entry;
        }
        if (!this.isOwnerCurrent()) {
            return null;
        }
        if (!this.historyComplete) {
            return entry;
        }
        if (entry) {
            admitRecordingCaptureClock(
                this.owner.clipId,
                entry.beat,
                entry.contextSeconds,
                this.ending,
                undefined,
                entry.passEntry
            );
        }
        const sourceStart = sampleZeroContextSeconds - this.latencySeconds;
        const sourceEnd = Math.min(sourceStart + sourceDurationSeconds, this.ending()?.contextSeconds ?? Infinity);
        const ordered = [...this.boundaries.values()].sort((left, right) => left.contextSeconds - right.contextSeconds);
        for (const boundary of ordered) {
            this.stage(boundary, sourceStart, sourceEnd);
        }
        return entry;
    }

    private stage(boundary: NativeCaptureBoundary, sourceStart: number, sourceEnd: number): void {
        if (
            !this.owner ||
            this.staged.has(boundary.key) ||
            (boundary.contextSeconds <= sourceStart && boundary.contextSeconds < this.owner.boundAtContextSeconds) ||
            boundary.contextSeconds > sourceEnd ||
            !this.isOwnerCurrent()
        ) {
            return;
        }
        const geometry = boundary.outgoing.geometry;
        const staged = admitRecordingCaptureClock(this.owner.clipId, undefined, undefined, this.ending, {
            originalTakeId: this.owner.originalTakeId,
            loopStart: geometry.loopStart,
            loopEnd: geometry.loopEnd,
            endBeat: boundary.endBeat,
            nextPassStartBeat: boundary.nextPassStartBeat,
            contextSeconds: boundary.contextSeconds,
            planned: boundary.planned,
        });
        if (staged === this.owner.originalTakeId) {
            this.staged.add(boundary.key);
        }
    }
}

export function createNativeRecordingCaptureHistory(
    trackId: string,
    initialAdmission: NativeClock['admission'],
    latencySeconds: number,
    ending: Ending
) {
    return new NativeRecordingCaptureHistory(trackId, initialAdmission, latencySeconds, ending);
}
