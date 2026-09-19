import { describe, expect, it } from 'vitest';

import { type DeviceParameterValueUnit } from '#/utils/deviceParameterValueUnit';
import { type AppAction } from '#/utils/handlerContract';

import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { parseVersionedCommandBatchEnvelope } from '../parseVersionedCommandBatchEnvelope';
import { parseVersionedCommandEnvelope } from '../parseVersionedCommandEnvelope';
import { resolveVersionedCommandBatchBindings } from '../resolveVersionedCommandBatchBindings';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';

function createParameterEnvelope(valueUnit?: DeviceParameterValueUnit) {
    const action: AppAction = {
        type: 'setDeviceParameter',
        payload: {
            deviceId: 'device-eq',
            paramId: 'eq-mid-freq',
            value: 2_400,
        },
    };
    if (valueUnit !== undefined) {
        action.payload.valueUnit = valueUnit;
    }
    return createExecutionCommandEnvelope({
        action,
        expectedEffect: 'Set one device parameter',
        normalizedProjectRevision: 'revision-1',
    }).envelope;
}

describe('setDeviceParameter native unit metadata', () => {
    it.each<DeviceParameterValueUnit>(['dB', 'Hz', 'ms', '%', ':1', 'semitones'])(
        'serializes and parses the %s carrier as canonical value metadata',
        (valueUnit) => {
            const envelope = createParameterEnvelope(valueUnit);

            expect(envelope.parameterUnits).toContainEqual({ argument: 'value', unit: valueUnit });
            expect(parseVersionedCommandEnvelope(serializeVersionedCommandEnvelope(envelope))).toEqual({
                status: 'valid',
                envelope,
            });
        }
    );

    it('keeps an omitted legacy carrier byte-semantically valid and unitless', () => {
        const envelope = createParameterEnvelope();
        const serialized = serializeVersionedCommandEnvelope(envelope);

        expect(envelope.parameterUnits).toContainEqual({ argument: 'value', unit: 'unitless' });
        expect(parseVersionedCommandEnvelope(serialized)).toEqual({ status: 'valid', envelope });
        expect(serializeVersionedCommandEnvelope(envelope)).toBe(serialized);
    });

    it('rejects metadata that disagrees with the serialized carrier', () => {
        const envelope = createParameterEnvelope('Hz');
        const tampered = {
            ...envelope,
            parameterUnits: envelope.parameterUnits.map((entry) =>
                entry.argument === 'value' ? { ...entry, unit: 'ms' } : entry
            ),
        };

        expect(parseVersionedCommandEnvelope(JSON.stringify(tampered))).toEqual({
            status: 'invalid',
            reason: 'Command argument metadata is incomplete',
        });
    });

    it('recomputes the carrier-backed value unit while resolving batch-local bindings', () => {
        const producer = createExecutionCommandEnvelope({
            action: {
                type: 'addDevice',
                payload: { deviceId: 'device-eq', deviceType: 'builtin-eq', trackId: 'track-1' },
            },
            expectedEffect: 'Create one equalizer',
            normalizedProjectRevision: 'revision-1',
        }).envelope;
        const consumer = createExecutionCommandEnvelope({
            action: {
                type: 'setDeviceParameter',
                payload: { deviceId: '$eq', paramId: 'eq-mid-freq', value: 2_400, valueUnit: 'Hz' },
            },
            dependencyIds: [producer.commandId],
            expectedEffect: 'Set one device parameter',
            normalizedProjectRevision: 'revision-1',
        }).envelope;
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-parameter-unit-binding',
            batchId: 'batch-parameter-unit-binding',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Create an equalizer and set its mid frequency',
            commands: [serializeVersionedCommandEnvelope(producer), serializeVersionedCommandEnvelope(consumer)],
            batchLocalBindings: [
                { bindingId: '$eq', producerArgument: 'deviceId', producerCommandId: producer.commandId },
            ],
        });
        const parsed = parseVersionedCommandBatchEnvelope(compiled.serialized);
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }

        const resolved = resolveVersionedCommandBatchBindings(parsed.envelope)[1];

        expect(resolved?.arguments).toMatchObject({ deviceId: 'device-eq', valueUnit: 'Hz' });
        expect(resolved?.parameterUnits).toContainEqual({ argument: 'value', unit: 'Hz' });
    });
});
