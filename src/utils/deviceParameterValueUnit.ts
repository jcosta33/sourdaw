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
            return 'dB';
        case 'hz':
            return 'Hz';
        case 'ms':
            return 'ms';
        case 'st':
        case 'semitones':
            return 'semitones';
        default:
            return null;
    }
}
