import { describe, expect, it } from 'vitest';

import { getPluginById } from '../../models/DeviceParameter';
import { getStableContractFingerprint } from '../../models/GetStableContractFingerprint';
import { getDeviceContractVersionForCommand } from '../getDeviceContractVersionForCommand';

describe('getDeviceContractVersionForCommand', () => {
    it('derives a stable semantic version from the live built-in descriptor', () => {
        const first = getDeviceContractVersionForCommand('builtin-compressor');
        const second = getDeviceContractVersionForCommand('builtin-compressor');

        expect(first).toMatch(/^descriptor-v1:[0-9a-f]{8}$/);
        expect(second).toBe(first);
        expect(getDeviceContractVersionForCommand('missing-device')).toBeUndefined();
    });

    it('includes Arrangement-owned guidance in the descriptor fingerprint', () => {
        const descriptor = getPluginById('builtin-compressor');
        if (!descriptor?.guidance) {
            throw new Error('Expected compressor guidance in the authoritative descriptor');
        }

        const mutatedGuidance = {
            ...descriptor,
            guidance: {
                ...descriptor.guidance,
                usage: 'Mutant guidance that must change the descriptor contract.',
            },
        };

        expect(getDeviceContractVersionForCommand('builtin-compressor')).toBe(
            `descriptor-v1:${getStableContractFingerprint(descriptor)}`
        );
        expect(getDeviceContractVersionForCommand('builtin-compressor')).not.toBe(
            `descriptor-v1:${getStableContractFingerprint(mutatedGuidance)}`
        );
    });

    it('includes Arrangement-owned domain capability identity in the descriptor fingerprint', () => {
        const descriptor = getPluginById('builtin-compressor');
        if (!descriptor?.capabilities) {
            throw new Error('Expected compressor domain capabilities in the authoritative descriptor');
        }

        const mutatedCapabilities = {
            ...descriptor,
            capabilities: {
                ...descriptor.capabilities,
                audioProcessing: {
                    availability: 'unavailable' as const,
                    reason: 'Mutant capability that must change the descriptor contract.',
                },
            },
        };

        expect(getDeviceContractVersionForCommand('builtin-compressor')).toBe(
            `descriptor-v1:${getStableContractFingerprint(descriptor)}`
        );
        expect(getDeviceContractVersionForCommand('builtin-compressor')).not.toBe(
            `descriptor-v1:${getStableContractFingerprint(mutatedCapabilities)}`
        );
    });
});
