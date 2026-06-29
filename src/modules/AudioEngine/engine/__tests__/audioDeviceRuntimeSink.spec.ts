import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAudioDeviceRuntimeSink, setAudioDeviceRuntimeSink } from '../audioDeviceRuntimeSink';

describe('audioDeviceRuntimeSink', () => {
    beforeEach(() => {
        setAudioDeviceRuntimeSink({});
    });

    afterEach(() => {
        setAudioDeviceRuntimeSink({});
    });

    it('routes configured runtime callbacks', () => {
        const emitDeviceLoaded = vi.fn();

        setAudioDeviceRuntimeSink({ emitDeviceLoaded });
        getAudioDeviceRuntimeSink().emitDeviceLoaded({ deviceId: 'device-1', deviceType: 'toaster' });

        expect(emitDeviceLoaded).toHaveBeenCalledTimes(1);
        expect(emitDeviceLoaded).toHaveBeenCalledWith({ deviceId: 'device-1', deviceType: 'toaster' });
    });

    it('resets omitted callbacks to no-ops when reconfigured', () => {
        const emitDeviceLoaded = vi.fn();

        setAudioDeviceRuntimeSink({ emitDeviceLoaded });
        setAudioDeviceRuntimeSink({});

        expect(() =>
            getAudioDeviceRuntimeSink().emitDeviceLoaded({ deviceId: 'device-1', deviceType: 'toaster' })
        ).not.toThrow();
        expect(emitDeviceLoaded).not.toHaveBeenCalled();
    });
});
