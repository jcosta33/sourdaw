import { tauriInvoke } from '#/utils/tauriBridge';

/**
 * A native input port as this session currently sees it.
 *
 * `id` is the identity the user's saved selection is keyed on and must survive
 * a replug; `portIndex` is the handle `open_midi_input` takes and is only ever
 * true for the enumeration it came from.
 */
export type TauriMidiPort = {
    id: string;
    name: string;
    portIndex: number;
};

type TauriMidiDevice = { index: number; name: string };

function isTauriMidiDevice(value: unknown): value is TauriMidiDevice {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    if (!('index' in value) || !('name' in value)) {
        return false;
    }

    return Number.isInteger(value.index) && typeof value.name === 'string';
}

/**
 * The device list arrives over IPC, so it is `unknown` until proven otherwise.
 * A bare cast let a malformed payload through as `id: "undefined"`, which then
 * reached `open_midi_input` as `NaN`. Same guard shape as the message-event
 * validation one file over.
 */
function isTauriMidiDeviceList(value: unknown): value is TauriMidiDevice[] {
    return Array.isArray(value) && value.every(isTauriMidiDevice);
}

/**
 * midir exposes exactly one durable property per port — its name — so that is
 * the identity. Two ports can still carry the same name (two units of the same
 * controller, or one device exposing several ports); nothing but their order
 * separates them, so those, and only those, are qualified — by their ordinal
 * among the same-named ports, not the global enumeration index, so that an
 * unrelated device joining or leaving cannot renumber them.
 */
function buildPortIds(devices: readonly TauriMidiDevice[]): TauriMidiPort[] {
    const nameCounts = new Map<string, number>();
    for (const device of devices) {
        nameCounts.set(device.name, (nameCounts.get(device.name) ?? 0) + 1);
    }

    const ordinals = new Map<string, number>();
    return devices.map((device) => {
        const ordinal = ordinals.get(device.name) ?? 0;
        ordinals.set(device.name, ordinal + 1);
        return {
            id: (nameCounts.get(device.name) ?? 0) > 1 ? `${device.name} #${ordinal}` : device.name,
            name: device.name,
            portIndex: device.index,
        };
    });
}

/**
 * Enumerate the native MIDI input ports.
 *
 * The backend identifies a port only by its position in the enumeration, and
 * that order is not stable across replugs, hub power cycles, or reboots.
 * Persisting it silently rebinds the saved selection to whichever device later
 * occupies the slot (issue #1837 F9), so callers key on `id` and re-resolve
 * `portIndex` from a fresh call every time they open a port.
 *
 * @throws TypeError when the IPC payload is not a device list.
 */
export async function listTauriMidiInputs(): Promise<TauriMidiPort[]> {
    const devices = await tauriInvoke('list_midi_inputs');
    if (!isTauriMidiDeviceList(devices)) {
        throw new TypeError('list_midi_inputs returned an invalid device list');
    }

    return buildPortIds(devices);
}
