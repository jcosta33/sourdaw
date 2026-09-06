/**
 * Whether the native engine voices a MIDI strip's notes, and which device it
 * sends them to (#3892).
 *
 * The engine holds one note store per hosted plugin
 * (`crates/daw-engine/src/midi/note_store.rs`), and `schedule-midi` addresses
 * it by device. So a MIDI strip is voiced natively exactly when the engine
 * already owns an external instance on that strip's own chain — the same
 * attach state `stripCarriers` reads, and for the same reason: a device naming
 * an instance the engine does not hold names nothing that could sound.
 *
 * One law, two readers. `projectLiveMidiProgramme` reads the device so it can
 * address the notes; `projectLiveGraphProgramme` reads only whether the outcome
 * is `voiced`, and a second copy of the rule there is how the two start
 * disagreeing — a strip left out of `webVoicedStripIds` that the MIDI producer
 * never targets is a track nothing plays at all.
 *
 * ── The instrument is the first such device ───────────────────────────────
 *
 * A MIDI strip's instrument sits at the head of its chain, so the first
 * attached external plugin on it is the note sink and any later one is an
 * effect. #3124 will let a device declare itself the sink explicitly; until it
 * does, chain order is the convention every DAW places an instrument by.
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

function attachedExternalDevice(input: NativeMidiNoteSinkInput): Device | undefined {
    return input.track.devices.find(
        (device) => device.externalInstanceId !== undefined && input.attachedInstanceIds.has(device.externalInstanceId)
    );
}

export function nativeMidiNoteSink(input: NativeMidiNoteSinkInput): NativeMidiNoteSink {
    const { track } = input;
    if (track.kind !== 'midi' || input.bakedStripIds.has(track.id)) {
        return { outcome: 'none' };
    }
    const device = attachedExternalDevice(input);
    if (!device) {
        return { outcome: 'none' };
    }
    if (track.devices.some((candidate) => candidate.type === GENERATIVE_DEVICE_TYPE)) {
        return { outcome: 'excluded', reason: GENERATIVE_MIDI_EXCLUSION_REASON };
    }
    return { outcome: 'voiced', device };
}
