import { type AudioGraphCommand } from '../../models/AudioGraphBackend';

/**
 * Every bank key one batch's devices name, in first-appearance order (#3124).
 *
 * Read from the three commands that carry a device, so what a caller stages is
 * exactly what the batch maps — never a second rule about which instruments a
 * session needs. Deduped, because two strips carrying one instrument share one
 * staged bank: that sharing is why a key names an instrument rather than a
 * device.
 */
export function collectNativeSampleBankKeys(commands: readonly AudioGraphCommand[]): readonly string[] {
    const keys = new Set<string>();
    for (const command of commands) {
        if (command.kind === 'create-track-strip' || command.kind === 'create-bus-strip') {
            for (const device of command.devices) {
                if (device.sampleBankKey !== undefined) {
                    keys.add(device.sampleBankKey);
                }
            }
            continue;
        }
        if (command.kind === 'insert-device' && command.device.sampleBankKey !== undefined) {
            keys.add(command.device.sampleBankKey);
        }
    }
    return [...keys];
}
