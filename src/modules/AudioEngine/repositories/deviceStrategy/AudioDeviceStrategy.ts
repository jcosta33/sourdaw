import { type Device } from '../../models/TrackViewTypes';
import { type OfflineDeviceNode } from '../devices/types';

import { UnsupportedDeviceTypeError } from './unsupportedDeviceTypeError';

export type OfflineAutomationSegment = {
    startFrame: number;
    endFrame: number;
    startValue: number;
    endValue: number;
};

/** A single AudioParam an offline automation lane drives, with its unit scaling. */
export type OfflineAutomationTarget = {
    readonly audioParam: AudioParam;
    readonly scale: number;
    readonly offset: number;
};

/**
 * How offline device-param automation for one parameter reaches a device. A
 * device either exposes one or more real `AudioParam`s (scheduled with the
 * shared AU-1 curve kernel) or accepts frame-addressed segments its worklet
 * interpolates. This is the single capability the offline scheduler routes all
 * device automation through — no hardcoded param map, no opt-in node list
 * (finding OE-3).
 */
export type OfflineAutomationBinding =
    | { readonly kind: 'audioParam'; readonly targets: readonly OfflineAutomationTarget[] }
    | { readonly kind: 'segments'; readonly apply: (segments: readonly OfflineAutomationSegment[]) => void };

/**
 * One note-on, addressed by name.
 *
 * This used to be four positional `number`s — `(noteOrPad, velocity, midiNote?,
 * sampleFrame?)` — projected onto every instrument the offline renderer can
 * build. That projection was Toaster's signature. Fermenter, Levain and Grand
 * Boule really take `(note, velocity, sampleFrame?, channel?)`, so the offline
 * dispatcher fed their `sampleFrame` slot `undefined` and their `channel` slot
 * the frame number. Every note of an offline part for those three lost its
 * sample-accurate placement and voiced on a nonsense MPE channel. Because all
 * four slots are `number`, the compiler had nothing to object to and never
 * would have.
 *
 * Naming the fields removes the dispatcher's ability to misroute a note: there
 * is no slot to put the frame in by mistake. It does not make the whole class
 * of mistake impossible, and it is worth being exact about the remaining gap.
 * The positional call survives inside the per-device adapters in
 * `nativeDspDeviceFactories`, one adapter per note API. Those two adapters'
 * parameter types are mutually assignable — same arity, every parameter
 * `number | undefined`, and parameter names carry no weight in assignability —
 * so binding a device to the wrong adapter still compiles and still reproduces
 * this defect. What holds that edge is `nativeDspNoteBinding.spec.ts`, which
 * drives every note-voicing entry of the factory table and asserts the slots.
 */
export type DeviceNoteOnRequest = {
    /** MIDI pitch for melodic instruments; pad index for pad-addressed devices. */
    readonly noteOrPad: number;
    readonly velocity: number;
    /** Frame within the render at which the note must sound. Omitted means "now". */
    readonly sampleFrame?: number;
    /** Pad-addressed devices only: the MIDI note the pad should voice. */
    readonly midiNote?: number;
    /** MPE member channel. Omitted means the base channel. */
    readonly channel?: number;
    /** Device-owned per-note articulation id; only supplied to an explicitly capable instrument. */
    readonly articulationId?: number;
};

export type DeviceNoteOffRequest = {
    readonly noteOrPad: number;
    readonly sampleFrame?: number;
    /**
     * MPE member channel to release. Omitted releases every voice at that
     * pitch, which is what a device with no channel surface does anyway.
     *
     * A note-off that does not name its channel cannot tell two notes at the
     * same pitch apart, so releasing one silences both. Live playback passes
     * it; a bounce that dropped it disagreed with the session on exactly the
     * overlapping unison MPE exists to voice separately.
     */
    readonly channel?: number;
};

/**
 * One MPE per-note expression update, in engine units.
 *
 * The values arrive already normalised — semitones, 0..1 pressure and bipolar
 * slide — because `engine/noteExpression` owns the single wire-unit conversion
 * and the live and offline callers both go through it. A strategy converts
 * nothing; it only addresses the right voice.
 *
 * That address is `noteOrPad` and `channel` together, never the pitch alone:
 * the engines touch only a voice still held on that member channel, so a
 * ringing release tail or a genuine MPE unison at the same pitch is left alone.
 */
export type DeviceNoteExpressionRequest = {
    readonly noteOrPad: number;
    readonly channel: number;
    readonly bendSemitones: number;
    readonly pressure: number;
    readonly slide: number;
    /** Frame within the render at which the expression must apply. Omitted means "now". */
    readonly sampleFrame?: number;
};

export type AudioDeviceStrategy = {
    readonly node: OfflineDeviceNode;
    /** Rejects if an initialized processor dies while an offline render is active. */
    readonly runtimeFailure?: Promise<never>;
    /** Round-trips terminal processor state before an offline buffer is accepted. */
    readonly runtimeHealthCheck?: () => Promise<void>;
    /**
     * Whether this device voices notes. `scheduleTrackClips` reads the first
     * chain entry that carries a note surface as the track's instrument, so
     * this decides who receives the track's MIDI.
     *
     * It is required, and it is a declaration rather than something
     * `buildDeviceChain` infers. Inferring it from `strategy.noteOn` looked
     * equivalent and was not: `NativeDspDeviceStrategy` implements `noteOn` as
     * a prototype method that forwards to an optional one on the DSP node, so
     * the property is truthy on Gluten, Proof and Bacteria — devices with no
     * note API at all. Whichever of those sat first in a rack claimed the
     * track's notes and swallowed them, and the instrument behind it rendered
     * silent. Live playback picks its instrument by device type and was never
     * affected, which is why a bounce could disagree with the session.
     */
    readonly acceptsNotes: boolean;
    setParam(name: string, value: number): void;
    /**
     * Resolve how offline automation of `parameterId` reaches this device, or
     * `null` when the device cannot automate that parameter offline. Every
     * automatable device implements this; the offline scheduler asks each device
     * rather than consulting an allow-list (OE-3).
     */
    resolveOfflineAutomation(parameterId: string): OfflineAutomationBinding | null;
    acceptsScheduledParam?(name: string): boolean;
    scheduleParam?(name: string, segments: readonly OfflineAutomationSegment[]): void;
    setBypass?(bypassed: boolean): void;
    noteOn?(request: DeviceNoteOnRequest): void;
    noteOff?(request: DeviceNoteOffRequest): void;
    /**
     * Present only on a device whose engine actually voices per-note expression,
     * so its absence answers "can this instrument bend a note?" instead of
     * accepting a call that silently does nothing. That is the same distinction
     * `acceptsNotes` above exists for: an unconditional forwarding method is
     * truthy on devices that have no such surface at all.
     */
    noteExpression?(request: DeviceNoteExpressionRequest): void;
    connectPadOutput?(pad: number, destination: AudioNode): void;
    disconnectPadOutput?(pad: number, destination: AudioNode): void;
    setPadDryRouted?(pad: number, routed: boolean): void;
    destroy?(): void;
};

export type DeviceCreator = (
    ctx: BaseAudioContext,
    device: Device
) => Promise<AudioDeviceStrategy> | AudioDeviceStrategy;

export class DeviceFactoryRegistry {
    private matchers: Array<{ test: (type: string) => boolean; creator: DeviceCreator }> = [];

    register(test: string | ((type: string) => boolean), creator: DeviceCreator): void {
        const isMatch = typeof test === 'string' ? (type: string) => type.startsWith(test) : test;
        this.matchers.push({ test: isMatch, creator });
    }

    async createDevice(ctx: BaseAudioContext, device: Device): Promise<AudioDeviceStrategy> {
        for (const matcher of this.matchers) {
            if (matcher.test(device.type)) {
                return matcher.creator(ctx, device);
            }
        }
        throw new UnsupportedDeviceTypeError(device.type, 'no registered factory matches this device type');
    }
}
