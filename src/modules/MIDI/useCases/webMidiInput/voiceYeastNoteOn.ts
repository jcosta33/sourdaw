import { type Device } from '#/modules/Arrangement/stores';
import { type audioEngine } from '#/modules/AudioEngine/useCases';
import { isBypassedNoteReceiver, type NoteReceivingInstrument, resolveDrumKitBy } from '#/utils/deviceTypeMatching';
import { resolveToasterPadIndex, TOASTER_NEUTRAL_MIDI_NOTE } from '#/utils/toasterNoteProjection';

import { type midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';
import { resolveDeviceNode } from './resolveDeviceNode';

/**
 * Length for a Yeast-generated note that reports no lifetime of its own, on a
 * voice that is not released by its note-off event.
 */
const FALLBACK_GENERATED_NOTE_SECONDS = 0.5;

/** Releases one captured voice at a sample frame, or at once when none is given. */
type CapturedVoiceRelease = (sampleFrame?: number, releaseVelocity?: number) => void;

type YeastVoicingStrip = ReturnType<typeof audioEngine.getTrackStrip>;
type YeastVoicingNode = NonNullable<YeastVoicingStrip>['deviceNodes'][number];

/** The note surface Fermenter, Levain and Crumbs share: velocity in MIDI units, release by pitch and channel. */
type KeyboardVoice = Readonly<{
    noteOn: (note: number, velocity: number, sampleFrame?: number, channel?: number) => void;
    noteOff: (note: number, sampleFrame?: number, channel?: number) => void;
}>;

type YeastVoicingDependencies = Pick<
    typeof midiMessageHandlerDependencies,
    | 'getDrumKitByIndex'
    | 'getDrumKitDefByIndex'
    | 'getSynthParamsForTrack'
    | 'scheduleDrumKitNote'
    | 'scheduleKitNote'
    | 'scheduleNote'
> & {
    /** The event bus instance the handlers are injected with. */
    eventBus: Pick<InstanceType<(typeof midiMessageHandlerDependencies)['eventBus']>, 'emit'>;
};

type VoiceYeastNoteOnInput = Readonly<{
    note: number;
    velocity: number;
    channel: number;
    sampleFrame: number;
    /** The held lifetime a generated note carries, when it carries one. */
    durationSamples: number | undefined;
    /** The instrument track's receiving instrument (`resolveLiveInputNoteReceiver`). */
    receiver: NoteReceivingInstrument<Device> | null;
    instrumentTrackId: string;
    trackDevices: readonly Device[];
    /** The child pad a Toaster child's key plays, or null for the instrument track's own key. */
    toasterChildPad: number | null;
    strip: YeastVoicingStrip;
    /** Keys a Faust instrument's voice on and off at a time, as `startFaustNote` does. */
    engine: Pick<typeof audioEngine, 'scheduleDeviceKeyOn' | 'scheduleDeviceKeyOff'>;
    context: BaseAudioContext;
    /** The strip input a kit or built-in synth voice connects to. */
    resolveDestination: () => AudioNode;
    deps: YeastVoicingDependencies;
    /** Starts a voice and keeps its release, so the note-off reaches the device that note-on reached. */
    capture: (start: () => void, release: CapturedVoiceRelease) => void;
}>;

function toasterPad(note: number, toasterChildPad: number | null): { pad: number; midiNote: number } | null {
    if (toasterChildPad !== null && toasterChildPad !== -1) {
        return toasterChildPad >= 0 && toasterChildPad < 16 ? { pad: toasterChildPad, midiNote: note } : null;
    }
    const pad = resolveToasterPadIndex(note);
    return pad === null ? null : { pad, midiNote: TOASTER_NEUTRAL_MIDI_NOTE };
}

/**
 * A generated voice starts ahead of the key that caused it, by the Yeast
 * worker's lookahead, while a key-up releases at its own frame. A note-off
 * framed before its note-on leaves the voice sounding on an instrument that
 * orders its events by frame, so a timed release never precedes the voice's
 * onset.
 */
function captureReleasingAfterOnset(input: VoiceYeastNoteOnInput): VoiceYeastNoteOnInput['capture'] {
    return (start, release) =>
        input.capture(start, (releaseFrame, releaseVelocity) => {
            if (releaseFrame === undefined) {
                release(undefined, releaseVelocity);
                return;
            }
            release(Math.max(releaseFrame, input.sampleFrame), releaseVelocity);
        });
}

function generatedNoteSeconds(input: VoiceYeastNoteOnInput): number {
    if (input.durationSamples === undefined) {
        return FALLBACK_GENERATED_NOTE_SECONDS;
    }
    return Math.max(0, input.durationSamples) / input.context.sampleRate;
}

function keyboardVoice(deviceNode: YeastVoicingNode | undefined, deviceType: string): KeyboardVoice | undefined {
    if (deviceType === 'fermenter') {
        return deviceNode?.fermenterControls;
    }
    if (deviceType === 'levain') {
        return deviceNode?.levainControls;
    }
    return deviceNode?.crumbsControls;
}

function voiceWorkletSynth(input: VoiceYeastNoteOnInput, device: Device): void {
    const { note, velocity, channel, sampleFrame, capture } = input;
    const deviceNode = resolveDeviceNode(input.strip, { deviceId: device.id, type: device.type });
    if (device.type === 'grand-boule') {
        const control = deviceNode?.grandBouleControls;
        if (control) {
            capture(
                () => control.noteOn(note, velocity / 127, sampleFrame, channel),
                (releaseFrame, releaseVelocity) => {
                    control.noteOff(note, releaseFrame, releaseVelocity, channel);
                    void input.deps.eventBus.emit('midi.noteOff', {
                        deviceId: device.id,
                        midiNote: note,
                        releaseVelocity,
                    });
                }
            );
        }
        void input.deps.eventBus.emit('midi.noteOn', { deviceId: device.id, midiNote: note, velocity: velocity / 127 });
        return;
    }
    const voice = keyboardVoice(deviceNode, device.type);
    if (!voice) {
        return;
    }
    capture(
        () => voice.noteOn(note, velocity, sampleFrame, channel),
        (releaseFrame) => voice.noteOff(note, releaseFrame, channel)
    );
}

function voiceToaster(input: VoiceYeastNoteOnInput, device: Device): void {
    const control = resolveDeviceNode(input.strip, { deviceId: device.id, type: 'toaster' })?.toasterControls;
    const target = toasterPad(input.note, input.toasterChildPad);
    if (!control || !target) {
        return;
    }
    input.capture(
        () => control.noteOn(target.pad, input.velocity, target.midiNote, input.sampleFrame),
        (releaseFrame) => control.noteOff(target.pad, releaseFrame)
    );
}

function voiceDrumKit(input: VoiceYeastNoteOnInput): void {
    const { deps, context } = input;
    const time = input.sampleFrame / context.sampleRate;
    const kitDefinition = resolveDrumKitBy(input.trackDevices, deps.getDrumKitDefByIndex);
    if (kitDefinition) {
        deps.scheduleDrumKitNote(context, input.resolveDestination(), kitDefinition, input.note, time, input.velocity);
        return;
    }
    const kit = resolveDrumKitBy(input.trackDevices, deps.getDrumKitByIndex);
    if (kit) {
        deps.scheduleKitNote(
            context,
            input.resolveDestination(),
            kit,
            input.note,
            time,
            generatedNoteSeconds(input),
            input.velocity
        );
    }
}

function voiceFaust(input: VoiceYeastNoteOnInput, device: Device): void {
    const { instrumentTrackId, note, context, engine } = input;
    input.capture(
        () =>
            engine.scheduleDeviceKeyOn(
                instrumentTrackId,
                device.id,
                note,
                input.velocity,
                input.sampleFrame / context.sampleRate
            ),
        (releaseFrame) =>
            engine.scheduleDeviceKeyOff(
                instrumentTrackId,
                device.id,
                note,
                0,
                releaseFrame === undefined ? context.currentTime : releaseFrame / context.sampleRate
            )
    );
}

function voiceBuiltinSynth(input: VoiceYeastNoteOnInput): void {
    const { deps, context } = input;
    deps.scheduleNote(
        context,
        input.resolveDestination(),
        input.note,
        input.sampleFrame / context.sampleRate,
        generatedNoteSeconds(input),
        input.velocity,
        deps.getSynthParamsForTrack(input.instrumentTrackId)
    );
}

/**
 * Voice one note-on Yeast generated from live input on the instrument track's
 * receiving instrument, the one the key itself reaches without Yeast and the
 * one sequenced playback and the export voice. Each kind is delivered as the
 * live path delivers it; a voice whose note-off event releases it is captured
 * with that release, so the note-off reaches the device its note-on reached.
 * A bypassed receiver plays nothing, and a chain with no instrument plays the
 * built-in synth.
 */
export function voiceYeastNoteOn(voicing: VoiceYeastNoteOnInput): void {
    const input: VoiceYeastNoteOnInput = { ...voicing, capture: captureReleasingAfterOnset(voicing) };
    const { receiver } = input;
    if (isBypassedNoteReceiver(receiver)) {
        return;
    }
    switch (receiver?.kind) {
        case 'worklet-synth':
            voiceWorkletSynth(input, receiver.device);
            return;
        case 'toaster':
            voiceToaster(input, receiver.device);
            return;
        case 'drum':
            voiceDrumKit(input);
            return;
        case 'faust':
            voiceFaust(input, receiver.device);
            return;
        default:
            voiceBuiltinSynth(input);
    }
}
