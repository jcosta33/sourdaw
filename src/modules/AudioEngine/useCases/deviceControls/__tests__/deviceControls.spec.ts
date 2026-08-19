import { describe, it, expect, vi, afterEach } from 'vitest';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { addMidiFxToStrip } from '../addMidiFxToStrip';
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

// Each use case below is a one-line delegator onto the `audioEngine`
// repository singleton (covered end-to-end elsewhere). A wiring bug — wrong
// method, dropped/reordered arg — would ship silently since TypeScript can't
// catch a call to the wrong method with a compatible signature, so each test
// asserts the exact method + argument list reaching the engine.
describe('deviceControls delegators', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('addMidiFxToStrip forwards to audioEngine.addMidiFxToStrip', () => {
        const spy = vi.spyOn(audioEngine, 'addMidiFxToStrip').mockImplementation(() => undefined);
        addMidiFxToStrip('t1', 'fx1', 'arp');
        expect(spy).toHaveBeenCalledWith('t1', 'fx1', 'arp');
    });

    it('removeMidiFxFromStrip forwards to audioEngine.removeMidiFxFromStrip', () => {
        const spy = vi.spyOn(audioEngine, 'removeMidiFxFromStrip').mockImplementation(() => undefined);
        removeMidiFxFromStrip('t1', 'fx1');
        expect(spy).toHaveBeenCalledWith('t1', 'fx1');
    });

    it('scheduleDeviceKeyOff forwards to audioEngine.scheduleDeviceKeyOff', () => {
        const spy = vi.spyOn(audioEngine, 'scheduleDeviceKeyOff').mockImplementation(() => undefined);
        scheduleDeviceKeyOff('t1', 'd1', 60, 100, 1.5);
        expect(spy).toHaveBeenCalledWith('t1', 'd1', 60, 100, 1.5);
    });

    it('scheduleDeviceKeyOn forwards to audioEngine.scheduleDeviceKeyOn', () => {
        const spy = vi.spyOn(audioEngine, 'scheduleDeviceKeyOn').mockImplementation(() => undefined);
        scheduleDeviceKeyOn('t1', 'd1', 60, 100, 1.5);
        expect(spy).toHaveBeenCalledWith('t1', 'd1', 60, 100, 1.5);
    });

    it('scheduleDeviceParam forwards to audioEngine.scheduleDeviceParam', () => {
        const spy = vi.spyOn(audioEngine, 'scheduleDeviceParam').mockImplementation(() => undefined);
        scheduleDeviceParam('t1', 'd1', 'cutoff', 0.5, 2);
        expect(spy).toHaveBeenCalledWith('t1', 'd1', 'cutoff', 0.5, 2);
    });

    it('updateDeviceBypass forwards to audioEngine.updateDeviceBypass', () => {
        const spy = vi.spyOn(audioEngine, 'updateDeviceBypass').mockImplementation(() => undefined);
        updateDeviceBypass('t1', 'd1', true);
        expect(spy).toHaveBeenCalledWith('t1', 'd1', true);
    });

    it('updateDeviceParam forwards to audioEngine.updateDeviceParam', () => {
        const spy = vi.spyOn(audioEngine, 'updateDeviceParam').mockImplementation(() => undefined);
        updateDeviceParam('t1', 'd1', 'cutoff', 0.5);
        expect(spy).toHaveBeenCalledWith('t1', 'd1', 'cutoff', 0.5);
    });

    it('updateDevicePatch forwards to audioEngine.updateDevicePatch', () => {
        const spy = vi.spyOn(audioEngine, 'updateDevicePatch').mockImplementation(() => undefined);
        updateDevicePatch('t1', 'd1', { cutoff: 0.5 });
        expect(spy).toHaveBeenCalledWith('t1', 'd1', { cutoff: 0.5 });
    });

    it('updateMidiFxBypass forwards to audioEngine.updateMidiFxBypass', () => {
        const spy = vi.spyOn(audioEngine, 'updateMidiFxBypass').mockImplementation(() => undefined);
        updateMidiFxBypass('t1', 'fx1', true);
        expect(spy).toHaveBeenCalledWith('t1', 'fx1', true);
    });

    it('updateMidiFxParam forwards to audioEngine.updateMidiFxParam', () => {
        const spy = vi.spyOn(audioEngine, 'updateMidiFxParam').mockImplementation(() => undefined);
        updateMidiFxParam('t1', 'fx1', 'rate', 0.5);
        expect(spy).toHaveBeenCalledWith('t1', 'fx1', 'rate', 0.5);
    });
});

describe('registerTuningTable', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should forward a 128-entry frequency table to audioEngine.registerTuningTable', () => {
        const spy = vi.spyOn(audioEngine, 'registerTuningTable').mockImplementation(() => undefined);
        const frequencies = Array.from({ length: 128 }, (_, i) => 440 * 2 ** (i / 12));

        registerTuningTable(frequencies);

        expect(spy).toHaveBeenCalledWith(frequencies);
    });

    it('should reject a table that is not exactly 128 entries without calling the engine', () => {
        const spy = vi.spyOn(audioEngine, 'registerTuningTable').mockImplementation(() => undefined);

        expect(() => registerTuningTable([440])).toThrow('Tuning table must contain exactly 128 frequencies');
        expect(spy).not.toHaveBeenCalled();
    });
});
