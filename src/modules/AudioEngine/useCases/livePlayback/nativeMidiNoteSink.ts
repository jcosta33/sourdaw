/**
 * Whether the native engine voices a MIDI strip's notes, and which device it
 * sends them to (#3892).
 *
 * The engine holds one note store per device it registers one for — every
 * hosted plugin, and a built-in whose type sounds notes
 * (`BuiltinEffectType::sounds_notes`, mirrored by `soundsNotes` in
 * `nativeBuiltinBodies`) — and `schedule-midi` addresses it by device. A
 * hosted device is a sink only while the engine reports its instance attached,
 * the same attach state `stripCarriers` reads and for the same reason: a
 * device naming an instance the engine does not hold names nothing that could
 * sound. A built-in is a sink by its type alone, since the engine builds it
 * with the strip rather than attaching it later.
 *
 * One law, two readers, on the sink alone. `projectLiveMidiProgramme` reads the
 * device so it can address the notes; `projectLiveGraphProgramme` reads only
 * whether the outcome is `voiced`, and a second copy of the sink rule there is
 * how the two start disagreeing about which strip has one at all. Carriage is
 * a third gate the note producer applies after this one, and it is not the
 * whole truth by itself: a later carrier rule (`stripCarriers.ts`) can leave a
 * strip with a voiced sink on Web Audio all the same — an uncarried second
 * device in its chain, say, or live input monitoring — and Web Audio already
 * sounds a built-in there, so addressing it too would sound the same generator
 * twice.
 *
 * ── The instrument is the first such device ───────────────────────────────
 *
 * A MIDI strip's instrument sits at the head of its chain, so the first sink
 * across both kinds — the first attached hosted plugin or built-in instrument,
 * whichever comes first in chain order — is the note sink and any later device
 * is an effect. #3124 will let a device declare itself the sink explicitly;
 * until it does, chain order is the convention every DAW places an instrument
 * by. A built-in effect is never a sink.
 *
 * ── What disqualifies a strip ─────────────────────────────────────────────
 *
 * A frozen strip plays a bake that already contains its instrument, so sending
 * that instrument notes would print the part twice. A strip holding a `yeast`
 * device generates its notes on the Web Audio path and has no native route at
 * all — and unlike the cases above, that is a strip whose plugin a musician can
 * see and cannot hear, so it is named rather than passed over silently.
 */

import { type Device, type Track } from '#/modules/Arrangement/stores';

import { soundsNativeNotes } from './soundsNativeNotes';

/** What a `yeast` strip is told, and the one exclusion this law reports. */
export const GENERATIVE_MIDI_EXCLUSION_REASON = 'generative device stays on Web Audio';

/** The device type whose notes are produced on the Web Audio path. */
const GENERATIVE_DEVICE_TYPE = 'yeast';

export type NativeMidiNoteSinkInput = Readonly<{
    track: Track;
    /** The external plugin instances the native engine currently owns. */
    attachedInstanceIds: ReadonlySet<string>;
    /** The strips whose device chain the programme replaces with a bake. */
    bakedStripIds: ReadonlySet<string>;
}>;

export type NativeMidiNoteSink =
    /** The device the engine takes this strip's notes on. */
    | Readonly<{ outcome: 'voiced'; device: Device }>
    /** A strip the engine could have voiced, and why it does not. */
    | Readonly<{ outcome: 'excluded'; reason: string }>
    /** Nothing native was ever in question here. */
    | Readonly<{ outcome: 'none' }>;

function noteSinkDevice(input: NativeMidiNoteSinkInput): Device | undefined {
    return input.track.devices.find(
        (device) =>
            (device.externalInstanceId !== undefined && input.attachedInstanceIds.has(device.externalInstanceId)) ||
            soundsNativeNotes(device.type)
    );
}

export function nativeMidiNoteSink(input: NativeMidiNoteSinkInput): NativeMidiNoteSink {
    const { track } = input;
    if (track.kind !== 'midi' || input.bakedStripIds.has(track.id)) {
        return { outcome: 'none' };
    }
    const device = noteSinkDevice(input);
    if (!device) {
        return { outcome: 'none' };
    }
    if (track.devices.some((candidate) => candidate.type === GENERATIVE_DEVICE_TYPE)) {
        return { outcome: 'excluded', reason: GENERATIVE_MIDI_EXCLUSION_REASON };
    }
    return { outcome: 'voiced', device };
}
