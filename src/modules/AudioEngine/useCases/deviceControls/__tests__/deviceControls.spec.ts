import { describe, it, expect, vi, afterEach } from 'vitest';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { addDeviceToStrip } from '../addDeviceToStrip';
import { addMidiFxToStrip } from '../addMidiFxToStrip';
import { removeDeviceFromStrip } from '../removeDeviceFromStrip';
import { removeMidiFxFromStrip } from '../removeMidiFxFromStrip';
import { scheduleDeviceKeyOff } from '../scheduleDeviceKeyOff';
import { scheduleDeviceKeyOn } from '../scheduleDeviceKeyOn';
import { scheduleDeviceParam } from '../scheduleDeviceParam';
import { registerTuningTable } from '../tuningControls';
import { updateDeviceBypass } from '../updateDeviceBypass';
import { updateDeviceParam } from '../updateDeviceParam';
import { updateDevicePatch } from '../updateDevicePatch';
import { updateMidiFxBypass } from '../updateMidiFxBypass';
import { updateMidiFxParam } from '../updateMidiFxParam';

// Each of these use cases is a one-line delegator onto the `audioEngine`
// repository singleton (already covered end-to-end elsewhere). What is under
// test here is that each use case forwards to the *correct* method with the
// arguments unchanged — a wiring bug (wrong method, dropped/reordered arg)
// would ship silently since TypeScript can't catch a call to the wrong method
// with a compatible signature.
type DelegatorCase = {
    name: string;
    call: () => void;
    method: keyof typeof audioEngine;
    args: unknown[];
};

const cases: DelegatorCase[] = [
    {
        name: 'addDeviceToStrip',
        call: () => addDeviceToStrip('track-1', 'device-1', 'grinder', 'ext-1'),
        method: 'addDeviceToStrip',
        args: ['track-1', 'device-1', 'grinder', 'ext-1'],
    },
    {
        name: 'addMidiFxToStrip',
        call: () => addMidiFxToStrip('track-1', 'fx-1', 'arp'),
        method: 'addMidiFxToStrip',
        args: ['track-1', 'fx-1', 'arp'],
    },
    {
        name: 'removeDeviceFromStrip',
        call: () => removeDeviceFromStrip('track-1', 'device-1'),
        method: 'removeDeviceFromStrip',
        args: ['track-1', 'device-1'],
    },
    {
        name: 'removeMidiFxFromStrip',
        call: () => removeMidiFxFromStrip('track-1', 'fx-1'),
        method: 'removeMidiFxFromStrip',
        args: ['track-1', 'fx-1'],
    },
    {
        name: 'scheduleDeviceKeyOff',
        call: () => scheduleDeviceKeyOff('track-1', 'device-1', 60, 100, 1.5),
        method: 'scheduleDeviceKeyOff',
        args: ['track-1', 'device-1', 60, 100, 1.5],
    },
    {
        name: 'scheduleDeviceKeyOn',
        call: () => scheduleDeviceKeyOn('track-1', 'device-1', 60, 100, 1.5),
        method: 'scheduleDeviceKeyOn',
        args: ['track-1', 'device-1', 60, 100, 1.5],
    },
    {
        name: 'scheduleDeviceParam',
        call: () => scheduleDeviceParam('track-1', 'device-1', 'cutoff', 0.5, 2),
        method: 'scheduleDeviceParam',
        args: ['track-1', 'device-1', 'cutoff', 0.5, 2],
    },
    {
        name: 'updateDeviceBypass',
        call: () => updateDeviceBypass('track-1', 'device-1', true),
        method: 'updateDeviceBypass',
        args: ['track-1', 'device-1', true],
    },
    {
        name: 'updateDeviceParam',
        call: () => updateDeviceParam('track-1', 'device-1', 'cutoff', 0.5),
        method: 'updateDeviceParam',
        args: ['track-1', 'device-1', 'cutoff', 0.5],
    },
    {
        name: 'updateDevicePatch',
        call: () => updateDevicePatch('track-1', 'device-1', { cutoff: 0.5 }),
        method: 'updateDevicePatch',
        args: ['track-1', 'device-1', { cutoff: 0.5 }],
    },
    {
        name: 'updateMidiFxBypass',
        call: () => updateMidiFxBypass('track-1', 'fx-1', true),
        method: 'updateMidiFxBypass',
        args: ['track-1', 'fx-1', true],
    },
    {
        name: 'updateMidiFxParam',
        call: () => updateMidiFxParam('track-1', 'fx-1', 'rate', 0.5),
        method: 'updateMidiFxParam',
        args: ['track-1', 'fx-1', 'rate', 0.5],
    },
];

describe('deviceControls delegators', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    for (const { name, call, method, args } of cases) {
        it(`${name} should forward to audioEngine.${method} with its arguments unchanged`, () => {
            const spy = vi.spyOn(audioEngine, method).mockImplementation(() => undefined);

            call();

            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy).toHaveBeenCalledWith(...args);
        });
    }
});

describe('registerTuningTable', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should forward a 128-entry frequency table to audioEngine.registerTuningTable', () => {
        const spy = vi.spyOn(audioEngine, 'registerTuningTable').mockImplementation(() => undefined);
        const frequencies = Array.from({ length: 128 }, (_, i) => 440 * 2 ** (i / 12));

        registerTuningTable(frequencies);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(frequencies);
    });

    it('should reject a table that is not exactly 128 entries without calling the engine', () => {
        const spy = vi.spyOn(audioEngine, 'registerTuningTable').mockImplementation(() => undefined);

        expect(() => registerTuningTable([440])).toThrow('Tuning table must contain exactly 128 frequencies');
        expect(spy).not.toHaveBeenCalled();
    });
});
