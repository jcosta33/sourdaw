export const DEVICE_PARAMETER_VALUE_UNITS = ['dB', 'Hz', 'ms', '%', ':1', 'semitones'] as const;

export type DeviceParameterValueUnit = (typeof DEVICE_PARAMETER_VALUE_UNITS)[number];

export function normalizeDeviceParameterValueUnit(value: unknown): DeviceParameterValueUnit | null {
    if (typeof value !== 'string') {
        return null;
    }
    if (value === '%' || value === ':1') {
        return value;
    }
    switch (value.trim().toLocaleLowerCase()) {
        case 'db':
        case 'decibel':
        case 'decibels':
            return 'dB';
        case 'hz':
        case 'hertz':
            return 'Hz';
        case 'ms':
        case 'millisecond':
        case 'milliseconds':
            return 'ms';
        case 'percent':
        case 'percents':
            return '%';
        case 'st':
        case 'semitone':
        case 'semitones':
            return 'semitones';
        default:
            return null;
    }
}
