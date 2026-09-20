import { describe, expect, it } from 'vitest';

import { queryAgentDiscovery } from '#/modules/Project/useCases';

function receiptItems(domain: 'device' | 'preset', character: string) {
    const result = queryAgentDiscovery({ domain, filters: { text: character }, page: { limit: 50 } });
    if (result.status !== 'receipt') {
        throw new Error(`Expected ${domain} discovery receipt for ${character}.`);
    }
    return result.receipt.items;
}

describe('device character discovery', () => {
    it.each([
        { character: 'plate', deviceId: 'dutch-oven', presetId: 'fx-rev-plate' },
        { character: 'hall', deviceId: null, presetId: 'fx-rev-large-hall' },
        { character: 'room', deviceId: null, presetId: 'fx-rev-small-room' },
        { character: 'spring', deviceId: 'faust-spring-reverb', presetId: 'fx-rev-spring' },
        { character: 'tape', deviceId: 'faust-tape-delay', presetId: 'factory-faust-tape-slapback' },
        { character: 'tube', deviceId: null, presetId: 'fx-dist-warm-overdrive' },
        { character: 'bitcrush', deviceId: 'builtin-bitcrusher', presetId: 'fx-lofi-vinyl' },
    ])('resolves $character from owner metadata', ({ character, deviceId, presetId }) => {
        const devices = receiptItems('device', character);
        const presets = receiptItems('preset', character);

        expect(presets.some((item) => item.id === presetId)).toBe(true);
        if (deviceId === null) {
            expect(devices).toEqual([]);
            return;
        }
        expect(devices.find((item) => item.id === deviceId)).toMatchObject({
            evidence: { characterTags: expect.arrayContaining([character]) },
        });
    });

    it('keeps a tube preset association distinct from a tube device algorithm', () => {
        const tubePreset = receiptItems('preset', 'tube').find((item) => item.id === 'fx-dist-warm-overdrive');

        expect(tubePreset).toMatchObject({
            name: 'Warm Overdrive',
            evidence: {
                tags: expect.arrayContaining(['tube']),
                deviceTypes: ['builtin-distortion'],
            },
        });
        expect(receiptItems('device', 'tube')).toEqual([]);
    });
});
