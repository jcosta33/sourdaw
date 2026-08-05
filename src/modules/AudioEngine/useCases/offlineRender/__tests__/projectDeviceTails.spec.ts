import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/utils/automationDeviceTarget', () => ({
    getDeviceAutomationParameterId: vi.fn((targetId: string) => targetId.split(':')[1] ?? null),
    resolveDeviceAutomationTargetIndex: vi.fn(),
}));

import { resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';

import { projectDeviceTails } from '../projectDeviceTails';

const mockedResolveIndex = vi.mocked(resolveDeviceAutomationTargetIndex);

function makeDevice(type: string, overrides: Record<string, unknown> = {}) {
    return { id: `d-${type}`, type, parameterValues: {}, bypassed: false, ...overrides };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('projectDeviceTails — basic projection', () => {
    it('maps each device to include its tail from tailForDeviceType', () => {
        const tailFn = (type: string) => (type === 'reverb' ? ({ kind: 'seconds', seconds: 3 } as never) : undefined);
        const result = projectDeviceTails({
            devices: [makeDevice('reverb'), makeDevice('compressor')],
            tailForDeviceType: tailFn,
        });
        expect(result).toHaveLength(2);
        expect(result[0]!.tail).toEqual({ kind: 'seconds', seconds: 3 });
        expect(result[1]!.tail).toBeUndefined();
    });

    it('preserves device id, type, parameterValues, bypassed', () => {
        const result = projectDeviceTails({
            devices: [makeDevice('reverb', { parameterValues: { mix: 0.5 }, bypassed: true })],
            tailForDeviceType: () => undefined,
        });
        expect(result[0]!.id).toBe('d-reverb');
        expect(result[0]!.bypassed).toBe(true);
        expect(result[0]!.parameterValues).toEqual({ mix: 0.5 });
    });
});

describe('projectDeviceTails — automatedParameterIds', () => {
    it('starts with empty automatedParameterIds per device', () => {
        const result = projectDeviceTails({
            devices: [makeDevice('reverb'), makeDevice('delay')],
            tailForDeviceType: () => undefined,
        });
        expect(result[0]!.automatedParameterIds).toEqual([]);
        expect(result[1]!.automatedParameterIds).toEqual([]);
    });

    it('adds parameterId when automation lane targets a device with automated gate', () => {
        mockedResolveIndex.mockReturnValue(0);
        const result = projectDeviceTails({
            devices: [makeDevice('reverb')],
            automationLanes: [{ parameterId: 'd-reverb:mix', enabled: true }],
            tailForDeviceType: () => undefined,
        });
        expect(result[0]!.automatedParameterIds).toContain('mix');
    });

    it('skips disabled automation lanes', () => {
        mockedResolveIndex.mockReturnValue(0);
        const result = projectDeviceTails({
            devices: [makeDevice('reverb')],
            automationLanes: [{ parameterId: 'd-reverb:mix', enabled: false }],
            tailForDeviceType: () => undefined,
        });
        expect(result[0]!.automatedParameterIds).toEqual([]);
    });

    it('skips lanes that resolve to no target device (index < 0)', () => {
        mockedResolveIndex.mockReturnValue(-1);
        const result = projectDeviceTails({
            devices: [makeDevice('reverb')],
            automationLanes: [{ parameterId: 'd-other:mix' }],
            tailForDeviceType: () => undefined,
        });
        expect(result[0]!.automatedParameterIds).toEqual([]);
    });
});
