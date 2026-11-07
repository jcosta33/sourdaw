import { hasAutomaticRecordingMidiCapture } from '#/modules/Arrangement/useCases';
import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';
import { captureEventPositionAt } from '#/modules/MIDI/useCases';

import { beatAtSecondsFromAnchor, secondsBetweenBeats } from '../../models/TempoMap';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { transportStore } from '../../stores/transportStore';
import { nativeRecordingEntry } from '../playheadScheduler/nativeRecordingEntry';
import { type AutomaticPunchCapture, schedulerSession } from '../playheadScheduler/schedulerSession';

import { type createRecordingCaptureClocks } from './createRecordingCaptureClocks';
import { recordingLifecycle } from './recordingLifecycle';
import { redateNativePunchEnding } from './redateNativePunchEnding';

type NativeCaptureSnapshot = Parameters<typeof nativeRecordingEntry>[0];

type NativeGeometry = {
    secondsAtBeat: (beat: number) => number;
    beatAtSeconds: (seconds: number) => number;
    isLooping: boolean;
    loopStart: number;
    loopEnd: number;
};

function datePunchStart(
    beat: number,
    contextSeconds: number,
    requestedStartBeat: number,
    geometry?: NativeGeometry
): number | null {
    const state = transportStore.value;
    if (!state) {
        return null;
    }
    const startBeat = Math.max(beat, requestedStartBeat);
    if (geometry) {
        return contextSeconds + geometry.secondsAtBeat(startBeat) - geometry.secondsAtBeat(beat);
    }
    return contextSeconds + secondsBetweenBeats(tempoMapStore.value?.changes ?? [], beat, startBeat, state.tempo);
}

function datePunchEnding(
    outBeat: number,
    beat: number,
    contextSeconds: number,
    requestedStartBeat: number,
    geometry?: NativeGeometry,
    qualified = false
) {
    const state = transportStore.value;
    if (!state) {
        return null;
    }
    const loop = geometry ?? state;
    if (
        beat > outBeat ||
        (!qualified && loop.isLooping && beat < loop.loopEnd && outBeat > loop.loopEnd && loop.loopEnd > loop.loopStart)
    ) {
        return null;
    }
    const changes = structuredClone(tempoMapStore.value?.changes ?? []);
    const tempo = state.tempo;
    const secondsBetween = (from: number, to: number): number => {
        if (geometry) {
            return geometry.secondsAtBeat(to) - geometry.secondsAtBeat(from);
        }
        return secondsBetweenBeats(changes, from, to, tempo);
    };
    const endContextSeconds = contextSeconds + secondsBetween(beat, outBeat);
    return {
        startContextSeconds: contextSeconds + secondsBetween(beat, Math.max(beat, requestedStartBeat)),
        ending: {
            contextSeconds: endContextSeconds,
            beatAtContextSeconds: (seconds: number) => {
                if (geometry) {
                    return geometry.beatAtSeconds(geometry.secondsAtBeat(outBeat) + seconds - endContextSeconds);
                }
                return beatAtSecondsFromAnchor(changes, outBeat, seconds - endContextSeconds, tempo);
            },
            midiPosition: { beat: outBeat, passIndex: captureEventPositionAt({ audioTime: contextSeconds }).passIndex },
        },
    };
}

class AutomaticPunchEnding implements AutomaticPunchCapture {
    private readonly root = captureProjectRootIdentity();
    private readonly generation = schedulerSession.generation;
    private ending: NonNullable<ReturnType<typeof datePunchEnding>>['ending'] | null = null;
    private startContextSeconds: number | null = null;
    private nativeEnding = false;
    private nativeTarget: Parameters<typeof redateNativePunchEnding>[0] | null = null;
    private endingFrozen = false;
    private retired = false;
    private readonly unregister: () => void;

    constructor(
        readonly outBeat: number,
        private readonly anchor: () => { beat: number; contextSeconds: number } | null,
        private readonly captureClocks: ReturnType<typeof createRecordingCaptureClocks>
    ) {
        this.unregister = recordingLifecycle.registerCaptureClock(this.observe);
    }

    private current(): boolean {
        return (
            !this.retired &&
            captureProjectRootIdentity() === this.root &&
            schedulerSession.generation === this.generation
        );
    }

    private admit(beat: number, contextSeconds: number, snapshot?: NativeCaptureSnapshot): void {
        if (!this.current() || this.ending) {
            return;
        }
        this.startContextSeconds ??= datePunchStart(
            beat,
            contextSeconds,
            this.anchor()?.beat ?? beat,
            snapshot?.geometry
        );
        const dated = datePunchEnding(
            this.outBeat,
            beat,
            contextSeconds,
            this.anchor()?.beat ?? beat,
            snapshot?.geometry
        );
        if (!dated) {
            return;
        }
        this.startContextSeconds ??= dated.startContextSeconds;
        this.nativeEnding = snapshot !== undefined;
        this.nativeTarget = null;
        if (snapshot) {
            this.nativeTarget = {
                outBeat: this.outBeat,
                contextSeconds: dated.ending.contextSeconds,
                anchor: snapshot,
            };
        }
        this.ending = dated.ending;
    }

    private adoptBrowserEpoch(beat: number, contextSeconds: number): void {
        if (
            !this.ending ||
            this.endingFrozen ||
            this.nativeEnding ||
            captureEventPositionAt({ audioTime: contextSeconds }).passIndex !== this.ending.midiPosition.passIndex
        ) {
            return;
        }
        const dated = datePunchEnding(this.outBeat, beat, contextSeconds, beat, undefined, true);
        if (dated) {
            this.ending = { ...dated.ending, midiPosition: this.ending.midiPosition };
        }
    }

    private adoptNativeEpoch(snapshot: NativeCaptureSnapshot): void {
        if (!this.ending || !this.nativeTarget || this.endingFrozen) {
            return;
        }
        const next = redateNativePunchEnding(this.nativeTarget, snapshot);
        if (next === this.nativeTarget) {
            return;
        }
        this.nativeTarget = next;
        const geometry = next.anchor.geometry;
        this.ending = {
            ...this.ending,
            contextSeconds: next.contextSeconds,
            beatAtContextSeconds: (seconds) =>
                geometry.beatAtSeconds(geometry.secondsAtBeat(this.outBeat) + seconds - next.contextSeconds),
        };
    }

    private readonly observe: Parameters<typeof recordingLifecycle.registerCaptureClock>[0] = (
        beat,
        contextSeconds,
        _relocated,
        effective,
        _songSeconds,
        native,
        boundary,
        snapshot
    ) => {
        if (!this.current() || boundary?.planned || boundary?.cancelled) {
            return;
        }
        if (native && snapshot) {
            const entry = nativeRecordingEntry(snapshot);
            this.admit(entry.beat, entry.contextSeconds, snapshot);
            this.adoptNativeEpoch(snapshot);
        } else if (!native) {
            if (effective !== undefined) {
                this.adoptBrowserEpoch(beat, contextSeconds);
            }
            this.admit(beat, contextSeconds);
        }
    };

    readonly read = () => {
        if (!this.current()) {
            return { status: 'retired' as const };
        }
        const native = this.captureClocks.readAutomaticCarrier();
        if (
            native.carrier === 'native' &&
            native.status === 'available' &&
            native.snapshot.forwardAuthorized !== false
        ) {
            const entry = nativeRecordingEntry(native.snapshot);
            this.admit(entry.beat, entry.contextSeconds, native.snapshot);
            this.adoptNativeEpoch(native.snapshot);
        } else if (native.carrier === 'browser' && !this.ending) {
            const initial = this.anchor();
            if (initial) {
                this.admit(initial.beat, initial.contextSeconds);
            }
        }
        if (this.startContextSeconds === null) {
            return { status: 'pending' as const };
        }
        if (!this.ending) {
            return { status: 'open' as const, startContextSeconds: this.startContextSeconds };
        }
        this.endingFrozen ||= this.captureClocks.isAutomaticEndingSounded(this.ending, this.nativeEnding, native);
        return { status: 'bounded' as const, startContextSeconds: this.startContextSeconds, ending: this.ending };
    };

    readonly ready = () => {
        const bound = this.read();
        return (
            bound.status === 'bounded' &&
            (!hasAutomaticRecordingMidiCapture(this.read) ||
                this.captureClocks.isAutomaticEndingSounded(bound.ending, this.nativeEnding)) &&
            this.captureClocks.readyForAutomaticEnding(this.outBeat, bound.ending, this.nativeEnding)
        );
    };

    readonly dispose = () => {
        this.retired = true;
        this.unregister();
        this.captureClocks.dispose();
    };
}

/** One punch retains its out/occurrence while adopting only accepted tempo epochs. */
export function createAutomaticPunchEnding(
    outBeat: number,
    anchor: () => { beat: number; contextSeconds: number } | null,
    captureClocks: ReturnType<typeof createRecordingCaptureClocks>
): AutomaticPunchCapture {
    return new AutomaticPunchEnding(outBeat, anchor, captureClocks);
}
