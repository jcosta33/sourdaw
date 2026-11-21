import { resolveLiveNoteControls } from '#/modules/AudioEngine/useCases';

import { type WebMidiNoteReceiver } from '../../repositories/webMidi/routeYeastNoteOffToInstrument';

import { resolveLiveInputNoteReceiver } from './resolveLiveInputNoteReceiver';

/**
 * The worklet instrument a Yeast-generated note was voiced on, as the port the
 * panic release addresses: the same receiver the note-on handler picks, so a
 * forced release reaches the device that holds the voice. Null when the track's
 * receiver has no worklet note controls.
 */
export function resolveYeastNoteOffReceiver(
    devices: readonly Readonly<{ id: string; type: string }>[],
    routesToToasterPad: boolean
): WebMidiNoteReceiver | null {
    const receiver = resolveLiveInputNoteReceiver(devices, routesToToasterPad);
    if (receiver?.kind !== 'worklet-synth') {
        return null;
    }
    const controls = resolveLiveNoteControls(receiver.device.type);
    if (controls === null) {
        return null;
    }
    return { id: receiver.device.id, type: receiver.device.type, controlsKey: controls.controlsKey };
}
