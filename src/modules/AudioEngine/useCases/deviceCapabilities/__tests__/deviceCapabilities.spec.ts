import { describe, expect, it } from 'vitest';

import { dbToGain } from '#/utils/audioLevelLaw';

import { classifyNoteReceivingDevice } from '../classifyNoteReceivingDevice';
import { DRUM_KIT_DEFAULT_LEVEL_DB } from '../drumKitDefaultLevelDb';
import { isBuiltinSynthDevice } from '../isBuiltinSynthDevice';
import { isBypassedNoteReceiver } from '../isBypassedNoteReceiver';
import { isDrumDevice } from '../isDrumDevice';
import { readDrumKitOutputGain } from '../readDrumKitOutputGain';
import { resolveDrumKitBy } from '../resolveDrumKitBy';
import { resolveDrumKitOutputGain } from '../resolveDrumKitOutputGain';
import { resolveNoteReceivingInstrument } from '../resolveNoteReceivingInstrument';

const isFaust = (deviceType: string) => deviceType === 'faust-organ';

describe('deviceCapabilities wrappers', () => {
    it.each([
        ['builtin-drum-kit', 'drum'],
        ['builtin-synth-strings', 'builtin-synth'],
        ['grand-boule', 'worklet-synth'],
        ['toaster', 'toaster'],
        ['builtin-reverb', null],
        ['faust-organ', 'faust'],
        ['faust-reverb', null],
        ['not-a-device', null],
    ])('classifies %s as %s', (deviceType, kind) => {
        expect(classifyNoteReceivingDevice(deviceType, isFaust)).toBe(kind);
    });

    it.each([
        ['builtin-drum-machine-808', true, false],
        ['drum-kit', true, false],
        ['builtin-synth-brass', false, true],
        ['synth', false, true],
        ['builtin-reverb', false, false],
        ['not-a-device', false, false],
    ])('answers the family of %s', (deviceType, drum, synth) => {
        expect(isDrumDevice(deviceType)).toBe(drum);
        expect(isBuiltinSynthDevice(deviceType)).toBe(synth);
    });

    it('resolves the first instrument and reports its bypass', () => {
        const devices = [{ type: 'builtin-reverb' }, { type: 'builtin-synth' }, { type: 'fermenter', bypassed: true }];
        const receiver = resolveNoteReceivingInstrument(devices, isFaust);
        expect(receiver).toEqual({ device: devices[2], kind: 'worklet-synth' });
        expect(isBypassedNoteReceiver(receiver)).toBe(true);
        expect(isBypassedNoteReceiver(null)).toBe(false);
        expect(resolveNoteReceivingInstrument([{ type: 'builtin-reverb' }], isFaust)).toBeNull();
    });

    it('selects the kit and gain of the first drum device', () => {
        const devices: { type: string; parameterValues: Record<string, number> }[] = [
            { type: 'builtin-eq', parameterValues: { level: -20 } },
            { type: 'builtin-drum-kit', parameterValues: { kit: 1, level: -6 } },
        ];
        expect(resolveDrumKitBy(devices, (index) => `kit-${index}`)).toBe('kit-1');
        expect(resolveDrumKitBy([{ type: 'builtin-eq', parameterValues: {} }], (index) => `kit-${index}`)).toBeNull();
        expect(resolveDrumKitOutputGain(devices)).toBe(dbToGain(-6));
        expect(readDrumKitOutputGain({ parameterValues: { level: -6 } })).toBe(dbToGain(-6));
        expect(DRUM_KIT_DEFAULT_LEVEL_DB).toBe(0);
        expect(readDrumKitOutputGain({ parameterValues: {} })).toBe(1);
    });
});
