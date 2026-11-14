import { describe, expect, it } from 'vitest';

import { type ExternalPluginParameter } from '#/modules/PluginHost/stores';

import {
    buildExternalPluginParameterRows,
    filterExternalPluginParameterRows,
    resolveExternalPluginParameterStatus,
} from '../externalPluginParameterRows';

const parameter = (overrides: Partial<ExternalPluginParameter>): ExternalPluginParameter => ({
    id: 1,
    name: 'Param',
    value: 0,
    defaultValue: 0,
    minValue: 0,
    maxValue: 1,
    unit: '',
    isAutomatable: true,
    ...overrides,
});

describe('buildExternalPluginParameterRows', () => {
    it.each([
        { name: 'stepped over 0..1 is a toggle', scan: { is_stepped: true, is_enum: false }, max: 1, kind: 'toggle' },
        { name: 'enum over 0..1 is a toggle', scan: { is_stepped: false, is_enum: true }, max: 1, kind: 'toggle' },
        { name: 'stepped over 0..7 is stepped', scan: { is_stepped: true, is_enum: false }, max: 7, kind: 'stepped' },
        {
            name: 'not stepped over 0..1 is continuous',
            scan: { is_stepped: false, is_enum: false },
            max: 1,
            kind: 'continuous',
        },
    ])('$name', ({ scan, max, kind }) => {
        const [row] = buildExternalPluginParameterRows([parameter({ id: 4, maxValue: max })], [{ id: 4, ...scan }]);
        expect(row?.kind).toBe(kind);
    });

    it('treats a parameter missing from the scan as continuous', () => {
        const [row] = buildExternalPluginParameterRows(
            [parameter({ id: 4 })],
            [{ id: 5, is_stepped: true, is_enum: false }]
        );
        expect(row?.kind).toBe('continuous');
    });

    it('treats a stepped parameter over a fractional two-value range as stepped, not a toggle', () => {
        const [row] = buildExternalPluginParameterRows(
            [parameter({ id: 4, minValue: 0.5, maxValue: 1.5 })],
            [{ id: 4, is_stepped: true, is_enum: false }]
        );
        expect(row?.kind).toBe('stepped');
    });

    it('gives stepped controls step 1 and continuous controls a fine step across the range', () => {
        const rows = buildExternalPluginParameterRows(
            [parameter({ id: 1, maxValue: 7 }), parameter({ id: 2, minValue: 20, maxValue: 20020 })],
            [{ id: 1, is_stepped: true, is_enum: false }]
        );
        expect(rows.map((row) => row.step)).toEqual([1, 20]);
    });

    it('formats the value as a plain number with the unit when one is declared', () => {
        const rows = buildExternalPluginParameterRows(
            [
                parameter({ id: 1, value: 0.12345 }),
                parameter({ id: 2, value: 440, minValue: 20, maxValue: 20000, unit: 'Hz' }),
                parameter({ id: 3, value: 3, maxValue: 7 }),
            ],
            [{ id: 3, is_stepped: true, is_enum: false }]
        );
        expect(rows.map((row) => row.valueText)).toEqual(['0.123', '440 Hz', '3']);
    });

    it.each([
        { span: 1, value: 0.12345, expected: '0.123' },
        { span: 10, value: 3.14159, expected: '3.14' },
        { span: 100, value: 42.4567, expected: '42.5' },
        { span: 1000, value: 440.6, expected: '441' },
        { span: 20000, value: 8000.4, expected: '8000' },
    ])(
        'shows a continuous value over a span of $span with the precision that span deserves',
        ({ span, value, expected }) => {
            const [row] = buildExternalPluginParameterRows([parameter({ id: 1, value, maxValue: span })], undefined);

            expect(row?.valueText).toBe(expected);
        }
    );

    it('keeps the unit unless the values are normalized, where it describes a different number', () => {
        const hertz = [parameter({ id: 2, value: 0.004, unit: 'Hz' })];

        const plain = buildExternalPluginParameterRows(hertz, undefined, { valuesAreNormalized: false });
        const normalized = buildExternalPluginParameterRows(hertz, undefined, { valuesAreNormalized: true });

        expect(plain[0]?.valueText).toBe('0.004 Hz');
        expect(normalized[0]?.valueText).toBe('0.004');
    });
});

describe('filterExternalPluginParameterRows', () => {
    const rows = buildExternalPluginParameterRows(
        [parameter({ id: 1, name: 'Filter Cutoff' }), parameter({ id: 2, name: 'Resonance' })],
        undefined
    );

    it.each([
        { query: 'cutoff', expected: [1] },
        { query: '  RESO ', expected: [2] },
        { query: '', expected: [1, 2] },
        { query: 'zzz', expected: [] },
    ])('query "$query" keeps $expected', ({ query, expected }) => {
        expect(filterExternalPluginParameterRows(rows, query).map((row) => row.id)).toEqual(expected);
    });
});

describe('resolveExternalPluginParameterStatus', () => {
    const device = { externalPluginId: 'p', externalInstanceId: 'i' };
    const active = { status: 'active' as const };

    it.each([
        {
            name: 'a device with no instance',
            input: { device: { externalPluginId: 'p' }, pluginSupported: true, activation: active, parameterCount: 3 },
            kind: 'not-loaded',
        },
        {
            name: 'a plugin absent from the supported scan',
            input: { device, pluginSupported: false, activation: active, parameterCount: 3 },
            kind: 'not-loaded',
        },
        {
            name: 'an instance with no activation',
            input: { device, pluginSupported: true, activation: undefined, parameterCount: 3 },
            kind: 'not-loaded',
        },
        {
            name: 'a loading instance',
            input: { device, pluginSupported: true, activation: { status: 'loading' as const }, parameterCount: 3 },
            kind: 'loading',
        },
        {
            name: 'an active instance with no snapshot',
            input: { device, pluginSupported: true, activation: active, parameterCount: undefined },
            kind: 'unavailable',
        },
        {
            name: 'an active instance with zero parameters',
            input: { device, pluginSupported: true, activation: active, parameterCount: 0 },
            kind: 'empty',
        },
        {
            name: 'an active instance with parameters',
            input: { device, pluginSupported: true, activation: active, parameterCount: 3 },
            kind: 'list',
        },
    ])('$name resolves to $kind', ({ input, kind }) => {
        expect(resolveExternalPluginParameterStatus(input).kind).toBe(kind);
    });

    it('carries the activation failure message', () => {
        const status = resolveExternalPluginParameterStatus({
            device,
            pluginSupported: true,
            activation: { status: 'error', message: 'bad binary' },
            parameterCount: undefined,
        });
        expect(status).toEqual({ kind: 'failed', message: 'This plugin failed to load: bad binary' });
    });
});
