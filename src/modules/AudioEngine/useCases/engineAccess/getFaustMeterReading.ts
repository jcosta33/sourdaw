import { readFaustMeterReading } from '../../engine/faustMeterReadings';

/**
 * Latest bargraph reading a live Faust device posted for `paramId`, or `null`
 * while the device has posted nothing under that name (still loading, or a
 * name the DSP does not carry). Pull-based by design: meters are read at
 * animation rate, never pushed through React state per tick.
 */
export function getFaustMeterReading(deviceId: string, paramId: string): number | null {
    return readFaustMeterReading(deviceId, paramId);
}
