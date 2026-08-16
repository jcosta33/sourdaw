import { type TauriMidiPort } from './listTauriMidiInputs';

/**
 * Resolve a saved stable id against the current enumeration. An exact match
 * wins. Failing that, a collision-qualified id whose base name now matches
 * exactly one port resolves to that port: "MPK Mini #1" saved while two units
 * were plugged in still means the MPK Mini when only one remains. Two or more
 * candidates stay ambiguous — guessing between identical units is the misgrab
 * the stable id exists to prevent — and resolve to nothing.
 */
export function resolveTauriMidiPort(ports: readonly TauriMidiPort[], savedId: string): TauriMidiPort | undefined {
    const exact = ports.find((port) => port.id === savedId);
    if (exact) {
        return exact;
    }

    const baseName = savedId.replace(/ #\d+$/, '');
    const byName = ports.filter((port) => port.name === baseName);
    return byName.length === 1 ? byName[0] : undefined;
}
