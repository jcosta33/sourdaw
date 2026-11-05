import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setControlRoomMonitoring } from '#/modules/AudioEngine/useCases';
import { dbToGain } from '#/utils/audioLevelLaw';

import { controlRoomStore } from '../../../stores/controlRoom';
import { syncControlRoomMonitoring } from '../syncControlRoomMonitoring';

vi.mock('#/modules/AudioEngine/useCases', () => ({ setControlRoomMonitoring: vi.fn() }));

function setMonitoring(monitoring: { monoActive: boolean; dimActive: boolean; dimLevel: number }): void {
    controlRoomStore.update((state) => (state ? { ...state, ...monitoring } : state));
}

describe('syncControlRoomMonitoring', () => {
    let unsubscribe: () => void = () => undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        setMonitoring({ monoActive: false, dimActive: false, dimLevel: -20 });
    });

    afterEach(() => {
        unsubscribe();
        unsubscribe = () => undefined;
    });

    it('applies the held state to the app engine at setup, with no listening path named', () => {
        setMonitoring({ monoActive: true, dimActive: true, dimLevel: -12 });

        unsubscribe = syncControlRoomMonitoring();

        expect(setControlRoomMonitoring).toHaveBeenCalledExactlyOnceWith({
            monoActive: true,
            dimGain: dbToGain(-12),
        });
    });

    it('follows later store changes until unsubscribed', () => {
        unsubscribe = syncControlRoomMonitoring();
        vi.mocked(setControlRoomMonitoring).mockClear();

        setMonitoring({ monoActive: false, dimActive: true, dimLevel: -30 });
        expect(setControlRoomMonitoring).toHaveBeenLastCalledWith({ monoActive: false, dimGain: dbToGain(-30) });

        unsubscribe();
        vi.mocked(setControlRoomMonitoring).mockClear();
        setMonitoring({ monoActive: true, dimActive: false, dimLevel: -30 });
        expect(setControlRoomMonitoring).not.toHaveBeenCalled();
    });

    it('passes unity dim gain while dim is off, whatever the dim level', () => {
        setMonitoring({ monoActive: false, dimActive: false, dimLevel: -40 });

        unsubscribe = syncControlRoomMonitoring();

        expect(setControlRoomMonitoring).toHaveBeenCalledExactlyOnceWith({ monoActive: false, dimGain: 1 });
    });
});
