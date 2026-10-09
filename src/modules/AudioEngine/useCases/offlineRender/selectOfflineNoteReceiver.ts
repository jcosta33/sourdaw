import { isFaustInstrumentModule } from '#/modules/PluginHost/useCases';
import { type NoteReceivingInstrument, resolveNoteReceivingInstrument } from '#/utils/deviceTypeMatching';

import { type DeviceNodeEntry } from '../buildDeviceChain';

type OfflineNoteReceiver<TDevice> = Readonly<{
    /** The track's receiving instrument, or null when its chain holds none. */
    receiver: NoteReceivingInstrument<TDevice> | null;
    /**
     * The chain entry whose note surface voices that receiver: present only when
     * the receiver is node-backed and the render built it. A drum kit or the
     * built-in synth has no entry, and a receiver that failed to load leaves the
     * track on the fallback synth, as a chain with no instrument always has.
     */
    instrumentEntry: DeviceNodeEntry | undefined;
}>;

/**
 * The instrument an offline render (export, stems, bounce, freeze) sends a
 * track's notes to: the first note-accepting instrument in chain order, the one
 * every other route picks. The entry is matched to that device by id, never by
 * "the first entry with a note surface", which would hand a drum-first chain's
 * notes to the instrument behind the kit.
 */
export function selectOfflineNoteReceiver<TDevice extends { id: string; type: string }>(
    devices: readonly TDevice[],
    deviceEntries: readonly DeviceNodeEntry[]
): OfflineNoteReceiver<TDevice> {
    const receiver = resolveNoteReceivingInstrument(devices, isFaustInstrumentModule);
    if (!receiver || receiver.kind === 'drum' || receiver.kind === 'builtin-synth') {
        return { receiver, instrumentEntry: undefined };
    }
    const instrumentEntry = deviceEntries.find(
        (entry) => entry.deviceId === receiver.device.id && entry.instrumentControls !== undefined
    );
    return { receiver, instrumentEntry };
}
