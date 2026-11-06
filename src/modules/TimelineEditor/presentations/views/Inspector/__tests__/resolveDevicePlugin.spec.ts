import { describe, expect, it } from 'vitest';

import { resolveDevicePlugin } from '../resolveDevicePlugin';

type TestPlugin = { id: string; name: string };

const plugins: readonly TestPlugin[] = [
    { id: 'faust-de-esser', name: 'De-esser' },
    { id: 'builtin-synth', name: 'Subtractive Synth' },
    { id: 'builtin-reverb', name: 'Reverb' },
    { id: 'builtin-gain', name: 'Gain' },
];

describe('resolveDevicePlugin', () => {
    it.each([
        {
            case: 'exact id',
            device: { type: 'faust-de-esser', name: 'Whatever' },
            expected: 'faust-de-esser',
        },
        {
            case: 'builtin- prefix for a type stored without it',
            device: { type: 'synth', name: 'Lead' },
            expected: 'builtin-synth',
        },
        {
            case: 'type read as a display name, case-insensitive',
            device: { type: 'REVERB', name: 'Custom' },
            expected: 'builtin-reverb',
        },
        {
            case: 'stored-name fallback for a typeless device',
            device: { name: 'Gain' },
            expected: 'builtin-gain',
        },
        {
            case: 'stored-name fallback for an unknown type',
            device: { type: 'unknown-type', name: 'Gain' },
            expected: 'builtin-gain',
        },
        {
            case: 'typed device whose stored name equals another plugin name',
            device: { type: 'synth', name: 'Reverb' },
            expected: 'builtin-synth',
        },
        {
            case: 'external-plugin device named like a builtin resolves to nothing',
            device: { type: 'external-plugin', name: 'Reverb' },
            expected: undefined,
        },
    ])('$case', ({ device, expected }) => {
        expect(resolveDevicePlugin(plugins, device)?.id).toBe(expected);
    });
});
