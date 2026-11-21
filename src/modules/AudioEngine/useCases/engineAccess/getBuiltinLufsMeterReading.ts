import { type BuiltinLufsMeterReading } from '../../models/BuiltinLufsMeterReader';
import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * Current loudness reading of the loaded builtin LUFS meter, or `null` while
 * the device has no loaded node. Pull-based by design: meters are read at
 * animation rate, never pushed through React state per tick.
 */
export function getBuiltinLufsMeterReading(deviceId: string): BuiltinLufsMeterReading | null {
    return audioEngine.findLufsMeterReading(deviceId);
}
