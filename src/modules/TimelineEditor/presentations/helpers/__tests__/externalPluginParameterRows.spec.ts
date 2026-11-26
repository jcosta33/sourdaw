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
    displayText: null,
    stepCount: 0,
    isList: false,
    isReadOnly: false,
    ...overrides,
});

describe('buildExternalPluginParameterRows', () => {
    it.each([
        { name: 'a step count of 1 is a toggle', overrides: { stepCount: 1 }, kind: 'toggle' },
        { name: 'a step count above 1 is stepped', overrides: { stepCount: 3 }, kind: 'stepped' },
        { name: 'a list with no step count is stepped', overrides: { isList: true }, kind: 'stepped' },
        {
            name: 'a list with a step count of 1 is a toggle',
            overrides: { stepCount: 1, isList: true },
            kind: 'toggle',
        },
        { name: 'no step count and no list is continuous', overrides: {}, kind: 'continuous' },
    ])('$name', ({ overrides, kind }) => {
        const [row] = buildExternalPluginParameterRows([parameter({ id: 4, maxValue: 7, ...overrides })]);
        expect(row?.kind).toBe(kind);
    });

    it('steps a stepped control by its range over its step count and a continuous one finely across the range', () => {
        const rows = buildExternalPluginParameterRows([
            parameter({ id: 1, maxValue: 1, stepCount: 4 }),
            parameter({ id: 2, maxValue: 7, stepCount: 7 }),
            parameter({ id: 3, maxValue: 7, isList: true }),
            parameter({ id: 4, minValue: 20, maxValue: 20020 }),
        ]);
        expect(rows.map((row) => row.step)).toEqual([0.25, 1, 1, 20]);
    });

    it('carries the read-only flag so the control can be disabled', () => {
        const rows = buildExternalPluginParameterRows([parameter({ id: 1, isReadOnly: true }), parameter({ id: 2 })]);
        expect(rows.map((row) => row.readOnly)).toEqual([true, false]);
    });

    it('shows the plugin display text when it has one and the plain number with its unit when it has none', () => {
        const rows = buildExternalPluginParameterRows([
            parameter({ id: 1, value: 0.43, minValue: 20, maxValue: 20000, unit: 'Hz', displayText: '1.20 kHz' }),
            parameter({ id: 2, value: 440, minValue: 20, maxValue: 20000, unit: 'Hz' }),
            parameter({ id: 3, value: 0.12345 }),
            parameter({ id: 4, value: 3, maxValue: 7, stepCount: 7 }),
        ]);
        expect(rows.map((row) => row.valueText)).toEqual(['1.20 kHz', '440 Hz', '0.123', '3']);
        expect(rows.map((row) => row.displayText)).toEqual(['1.20 kHz', null, null, null]);
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
            const [row] = buildExternalPluginParameterRows([parameter({ id: 1, value, maxValue: span })]);

            expect(row?.valueText).toBe(expected);
        }
    );

    it('keeps the unit unless the values are normalized, where it describes a different number', () => {
        const hertz = [parameter({ id: 2, value: 0.004, unit: 'Hz' })];

        const plain = buildExternalPluginParameterRows(hertz, { valuesAreNormalized: false });
        const normalized = buildExternalPluginParameterRows(hertz, { valuesAreNormalized: true });

        expect(plain[0]?.valueText).toBe('0.004 Hz');
        expect(normalized[0]?.valueText).toBe('0.004');
    });
});

describe('filterExternalPluginParameterRows', () => {
    const rows = buildExternalPluginParameterRows([
        parameter({ id: 1, name: 'Filter Cutoff' }),
        parameter({ id: 2, name: 'Resonance' }),
    ]);

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
