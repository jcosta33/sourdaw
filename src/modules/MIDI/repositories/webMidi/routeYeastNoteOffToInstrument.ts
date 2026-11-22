import { resolveDeviceNode } from '../../models/ResolveDeviceNode';

import type { WebMidiInstrumentStrip } from './engineStripAccess';

/** The note-control object a worklet instrument's engine node exposes. */
export type WebMidiNoteControlsKey = 'fermenterControls' | 'grandBouleControls' | 'levainControls' | 'crumbsControls';

/** The device a track's notes reach and the note controls its engine node exposes. */
export type WebMidiNoteReceiver = Readonly<{
    id: string;
    type: string;
    controlsKey: WebMidiNoteControlsKey;
}>;

export type WebMidiInstrumentTrack = Readonly<{
    id: string;
    /** The receiving worklet instrument, or null when the track has none. */
    receiver: WebMidiNoteReceiver | null;
}>;

/**
 * Deliver one Note Off to the track's receiving instrument, the device its
 * voices were started on. The use-case layer resolves the receiver; this
 * function only addresses that device's node. Grand Boule also emits its MIDI
 * note-off event whenever it is the receiver, even when the strip/control is
 * not ready.
 *
 * `releaseVelocity` (normalized 0..1) is the MIDI note-off velocity; it is
 * forwarded to the Grand Boule control so the release dynamic survives the
 * rack-routed path.
 */
export function routeYeastNoteOffToInstrument(
    instrumentTrack: WebMidiInstrumentTrack,
    strip: WebMidiInstrumentStrip | undefined,
    note: number,
    releaseVelocity: number,
    emitGrandBouleEvent: (deviceId: string, midiNote: number) => void,
    sampleFrame?: number
): void {
    const receiver = instrumentTrack.receiver;
    if (!receiver) {
        return;
    }
    const deviceNode = resolveDeviceNode(strip, { deviceId: receiver.id, type: receiver.type });
    if (receiver.controlsKey === 'grandBouleControls') {
        deviceNode?.grandBouleControls?.noteOff(note, sampleFrame, releaseVelocity);
        emitGrandBouleEvent(receiver.id, note);
        return;
    }
    const controls = deviceNode?.[receiver.controlsKey];
    if (sampleFrame === undefined) {
        controls?.noteOff(note);
    } else {
        controls?.noteOff(note, sampleFrame);
    }
}
