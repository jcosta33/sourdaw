import { desktopInvoke } from '#/utils/desktopBridge';

/**
 * A native input port as this session currently sees it.
 *
 * `id` is the identity the user's saved selection is keyed on. It is built
 * native-side (`MidiDeviceInfo` in `crates/sourdaw-native/src/commands/midi.rs`,
 * the hand-maintained wire mirror of which this type is): midir's own stable
 * port id where the backend supplies one, its name/ordinal fallback where it
 * does not. `portIndex` is the handle `open_midi_input` takes and is only ever
 * true for the enumeration it came from.
 */
export type NativeMidiPort = {
    id: string;
    name: string;
    portIndex: number;
};

type NativeMidiDevice = { index: number; id: string; name: string };

function isNativeMidiDevice(value: unknown): value is NativeMidiDevice {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    if (!('index' in value) || !('id' in value) || !('name' in value)) {
        return false;
    }

    return Number.isInteger(value.index) && typeof value.id === 'string' && typeof value.name === 'string';
}

/**
 * The device list arrives over IPC, so it is `unknown` until proven otherwise.
 * A bare cast let a malformed payload through as `id: "undefined"`, which then
 * reached `open_midi_input` as `NaN`. Same guard shape as the message-event
 * validation one file over.
 */
function isNativeMidiDeviceList(value: unknown): value is NativeMidiDevice[] {
    return Array.isArray(value) && value.every(isNativeMidiDevice);
}

/**
 * Enumerate the native MIDI input ports.
 *
 * The backend identities the list carries are stable across replugs and hub
 * power cycles; the enumeration *order* behind `portIndex` never is (issue
 * #1837 F9), so callers key on `id` and re-resolve `portIndex` from a fresh
 * call every time they open a port.
 *
 * @throws TypeError when the IPC payload is not a device list.
 */
export async function listNativeMidiInputs(): Promise<NativeMidiPort[]> {
    const devices = await desktopInvoke('list_midi_inputs');
    if (!isNativeMidiDeviceList(devices)) {
        throw new TypeError('list_midi_inputs returned an invalid device list');
    }

    return devices.map((device) => ({
        id: device.id,
        name: device.name,
        portIndex: device.index,
    }));
}
