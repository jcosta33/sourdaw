import { classifyNoteReceivingDevice, type NoteReceivingInstrumentKind } from './NoteInputKindByDeviceType';

export type NoteReceivingInstrument<TDevice> = Readonly<{
    device: TDevice;
    kind: NoteReceivingInstrumentKind;
}>;

/**
 * The instrument a track's notes reach: the first note-accepting instrument in
 * device-chain order, as MIDI flows down a DAW chain to its first instrument and
 * every device after it receives that instrument's audio. Null when the chain
 * holds no instrument. Sequenced playback, the offline render (export, stems,
 * bounce, freeze), live MIDI input and audition all choose through this one
 * function, so no route can voice a different instrument from another.
 *
 * The built-in synth is the one exception to chain order. Every route already
 * voices a track with no other instrument on the built-in synth, and a new MIDI
 * track starts with one at the head of its chain, so an instrument added after
 * it appends behind it. Letting that default device take the notes would replace
 * the instrument the musician added with the default voice. It therefore
 * receives notes only when the chain holds no other instrument.
 */
export function resolveNoteReceivingInstrument<TDevice extends { type: string }>(
    devices: readonly TDevice[],
    isFaustInstrument: (deviceType: string) => boolean
): NoteReceivingInstrument<TDevice> | null {
    let builtinSynth: NoteReceivingInstrument<TDevice> | null = null;
    for (const device of devices) {
        const kind = classifyNoteReceivingDevice(device.type, isFaustInstrument);
        if (kind === null) {
            continue;
        }
        if (kind !== 'builtin-synth') {
            return { device, kind };
        }
        builtinSynth ??= { device, kind };
    }
    return builtinSynth;
}

/**
 * Whether the track's receiving instrument is bypassed. A bypassed instrument
 * keeps its place as the receiver, as a deactivated instrument does in a DAW:
 * the notes stop at it, so neither an instrument behind it nor the fallback
 * voice plays them, and every route leaves the track silent.
 */
export function isBypassedNoteReceiver(
    receiver: NoteReceivingInstrument<{ type: string; bypassed?: boolean }> | null
): boolean {
    return receiver?.device.bypassed === true;
}
