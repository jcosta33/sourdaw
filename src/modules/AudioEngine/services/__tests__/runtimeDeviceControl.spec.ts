import { describe, expect, it } from 'vitest';

import { compileRuntimeDeviceControl } from '../compileRuntimeDeviceControl';

describe('compileRuntimeDeviceControl', () => {
    const allowedParameterIds = ['drive', 'sag'] as const;

    function createControl(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            schemaVersion: 1,
            command: 'set-fallback-param',
            target: {
                trackId: 'track-1',
                deviceId: 'grinder-1',
                deviceType: 'grinder',
                parameterId: 'sag',
            },
            value: 0.5,
            correlation: {
                workletGeneration: 7,
                controlSequence: 3,
            },
            scheduling: {
                targetFrame: 48_000,
                deadlineFrame: 48_128,
            },
            ...overrides,
        };
    }

    it('compiles one exact immutable v1 fallback control against the captured parameter schema', () => {
        const result = compileRuntimeDeviceControl(createControl(), allowedParameterIds);

        expect(result).toEqual({
            status: 'compiled',
            control: {
                schemaVersion: 1,
                command: 'set-fallback-param',
                target: {
                    trackId: 'track-1',
                    deviceId: 'grinder-1',
                    deviceType: 'grinder',
                    parameterId: 'sag',
                },
                value: 0.5,
                correlation: {
                    workletGeneration: 7,
                    controlSequence: 3,
                },
                scheduling: {
                    targetFrame: 48_000,
                    deadlineFrame: 48_128,
                },
            },
        });
        if (result.status === 'compiled') {
            expect(Object.isFrozen(result.control)).toBe(true);
            expect(Object.isFrozen(result.control.target)).toBe(true);
            expect(Object.isFrozen(result.control.correlation)).toBe(true);
            expect(Object.isFrozen(result.control.scheduling)).toBe(true);
        }
    });

    it.each([
        [
            'unknown parameter',
            createControl({
                target: { trackId: 'track-1', deviceId: 'grinder-1', deviceType: 'grinder', parameterId: 'unknown' },
            }),
        ],
        ['unknown field', createControl({ unexpected: true })],
        ['non-finite value', createControl({ value: Number.NaN })],
        [
            'unsafe generation',
            createControl({ correlation: { workletGeneration: Number.MAX_SAFE_INTEGER + 1, controlSequence: 3 } }),
        ],
        ['out-of-order deadline', createControl({ scheduling: { targetFrame: 48_129, deadlineFrame: 48_128 } })],
    ])('rejects %s before a worklet can consume it', (_label, control) => {
        expect(compileRuntimeDeviceControl(control, allowedParameterIds)).toMatchObject({ status: 'invalid' });
    });
});
