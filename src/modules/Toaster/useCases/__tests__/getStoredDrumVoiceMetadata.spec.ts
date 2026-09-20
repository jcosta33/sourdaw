import { describe, expect, it } from 'vitest';

import { createDefaultKit } from '../../models/ToasterKit';
import { toToasterKitState } from '../../models/ToasterKitState';
import { getStoredDrumVoiceMetadata } from '../getStoredDrumVoiceMetadata';

describe('strict stored drum voice metadata', () => {
    it.each([undefined, null, {}, { version: 99, data: {} }, { version: 1, data: { kit: { pads: [] } } }])(
        'does not repair missing or malformed metadata %s',
        (chunk) => {
            expect(getStoredDrumVoiceMetadata(chunk).status).toBe('unknown');
        }
    );
    it('projects stored pitch and engine family without copying samples or performance patterns', () => {
        const kit = createDefaultKit();
        kit.pads[0] = { ...kit.pads[0]!, muted: true, volume: 0, midiNote: 70 };
        const state = toToasterKitState(kit);
        const before = structuredClone(state);
        expect(getStoredDrumVoiceMetadata(state)).toMatchObject({
            status: 'known',
            voices: expect.arrayContaining([{ pitch: 70, family: 'kick' }]),
        });
        expect(state).toEqual(before);
        expect(JSON.stringify(getStoredDrumVoiceMetadata(state))).not.toMatch(/patterns|sample|engineParams|soundLock/);
    });
    it('retains sample-only and unknown engine mappings as unknown families', () => {
        const state = toToasterKitState(createDefaultKit());
        const kit = createDefaultKit();
        kit.pads[0]!.engineType = 'sample';
        expect(getStoredDrumVoiceMetadata(toToasterKitState(kit))).toMatchObject({
            status: 'known',
            voices: expect.arrayContaining([{ pitch: 36, family: null }]),
        });
        const data = {
            version: state.version,
            data: {
                kit: {
                    pads: createDefaultKit().pads.map((pad, index) => ({
                        ...pad,
                        engineType: index === 0 ? 'future-engine' : pad.engineType,
                    })),
                },
            },
        };
        expect(getStoredDrumVoiceMetadata(data)).toMatchObject({
            status: 'known',
            voices: expect.arrayContaining([{ pitch: 36, family: null }]),
        });
    });
    it('keeps a generic CR-78 drum unknown because its declared engine spans kick, snare and tom', () => {
        const kit = createDefaultKit();
        kit.pads[0]!.engineType = 'cr78-drum';
        expect(getStoredDrumVoiceMetadata(toToasterKitState(kit))).toMatchObject({
            status: 'known',
            voices: expect.arrayContaining([{ pitch: 36, family: null }]),
        });
    });
    it('rejects ambiguous and invalid pitch mappings', () => {
        const kit = createDefaultKit();
        kit.pads[1]!.midiNote = kit.pads[0]!.midiNote;
        expect(getStoredDrumVoiceMetadata(toToasterKitState(kit)).status).toBe('unknown');
        kit.pads[1]!.midiNote = 200;
        expect(getStoredDrumVoiceMetadata(toToasterKitState(kit)).status).toBe('unknown');
    });
});
