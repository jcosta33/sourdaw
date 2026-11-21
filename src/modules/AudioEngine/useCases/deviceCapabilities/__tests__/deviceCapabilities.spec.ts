import { describe, expect, it } from 'vitest';

import { dbToGain } from '#/utils/audioLevelLaw';

import { classifyNoteReceivingDevice } from '../classifyNoteReceivingDevice';
import { DRUM_KIT_DEFAULT_LEVEL_DB } from '../drumKitDefaultLevelDb';
import { findMidiTransformDevice } from '../findMidiTransformDevice';
import { findPadOutputHost } from '../findPadOutputHost';
import { hasPadOutputHost } from '../hasPadOutputHost';
import { hostsPadOutputs } from '../hostsPadOutputs';
import { isBuiltinSynthDevice } from '../isBuiltinSynthDevice';
import { isBypassedNoteReceiver } from '../isBypassedNoteReceiver';
import { isDrumDevice } from '../isDrumDevice';
import { isMidiTransformDevice } from '../isMidiTransformDevice';
import { readDrumKitOutputGain } from '../readDrumKitOutputGain';
import { resolveDrumKitBy } from '../resolveDrumKitBy';
import { resolveDrumKitOutputGain } from '../resolveDrumKitOutputGain';
import { resolveLiveNoteControls } from '../resolveLiveNoteControls';
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

    it.each([
        ['yeast', true],
        ['Yeast', false],
        ['builtin-synth', false],
        ['fermenter', false],
        ['faust-organ', false],
        ['', false],
    ])('answers whether %j is a MIDI-transform device', (deviceType, expected) => {
        expect(isMidiTransformDevice(deviceType)).toBe(expected);
    });

    it.each([
        ['toaster', true],
        ['yeast', false],
        ['builtin-drum-kit', false],
        ['builtin-drum-machine-808', false],
        ['fermenter', false],
        ['builtin-eq', false],
        ['faust-organ', false],
        ['not-a-device', false],
        ['', false],
        ['toaster-x', false],
        ['Toaster', false],
        ['constructor', false],
        ['__proto__', false],
    ])('answers whether %j hosts pad outputs', (deviceType, expected) => {
        expect(hostsPadOutputs(deviceType)).toBe(expected);
    });

    it('finds the pad-output host, not the first device, on a chain', () => {
        const eq = { id: 'a', type: 'builtin-eq' };
        const toaster = { id: 'b', type: 'toaster' };
        const yeast = { id: 'c', type: 'yeast' };
        expect(findPadOutputHost([eq, toaster, yeast])).toBe(toaster);
        expect(hasPadOutputHost([eq, toaster, yeast])).toBe(true);
    });

    it('finds no pad-output host on a chain without one', () => {
        const devices = [
            { id: 'a', type: 'yeast' },
            { id: 'b', type: 'builtin-drum-kit' },
        ];
        expect(findPadOutputHost(devices)).toBeUndefined();
        expect(hasPadOutputHost(devices)).toBe(false);
        expect(hasPadOutputHost([])).toBe(false);
    });

    it('answers a device type built at run time', () => {
        expect(isMidiTransformDevice(['ye', 'ast'].join(''))).toBe(true);
        expect(isMidiTransformDevice(`built${'in-eq'}`)).toBe(false);
    });

    it('finds the first MIDI-transform device on a chain', () => {
        const devices = [
            { id: 'a', type: 'builtin-eq' },
            { id: 'b', type: 'yeast' },
            { id: 'c', type: 'yeast' },
        ];
        expect(findMidiTransformDevice(devices)).toBe(devices[1]);
        expect(findMidiTransformDevice(devices.slice(0, 1))).toBeUndefined();
        expect(findMidiTransformDevice([])).toBeUndefined();
    });

    it('resolves the first instrument and reports its bypass', () => {
        const devices = [{ type: 'builtin-reverb' }, { type: 'builtin-synth' }, { type: 'fermenter', bypassed: true }];
        const receiver = resolveNoteReceivingInstrument(devices, isFaust);
        expect(receiver).toEqual({ device: devices[2], kind: 'worklet-synth' });
        expect(isBypassedNoteReceiver(receiver)).toBe(true);
        expect(isBypassedNoteReceiver(null)).toBe(false);
        expect(resolveNoteReceivingInstrument([{ type: 'builtin-reverb' }], isFaust)).toBeNull();
    });

    it('answers the live note controls of a device type built at run time', () => {
        const grandBoule = resolveLiveNoteControls(['grand', 'boule'].join('-'));
        expect(grandBoule?.controlsKey).toBe('grandBouleControls');
        expect(grandBoule?.scaleVelocity(127)).toBe(1);
        expect(grandBoule?.expressionDimensions).toEqual(['pitchBend']);
        const crumbs = resolveLiveNoteControls(`builtin-${'crumbs'}`);
        expect(crumbs?.controlsKey).toBe('crumbsControls');
        expect(crumbs?.scaleVelocity(100)).toBe(100);
        expect(crumbs?.expressionDimensions).toEqual([]);
        expect(resolveLiveNoteControls(`builtin-${'reverb'}`)).toBeNull();
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
