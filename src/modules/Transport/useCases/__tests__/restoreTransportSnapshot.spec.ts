import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { setMasterGainValue } from '#/modules/AudioEngine/useCases';

import { defaultTransportState, transportStore, type TransportState } from '../../stores/transportStore';
import { restoreTransportSnapshot } from '../restoreTransportSnapshot';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    setMasterGainValue: vi.fn(),
}));

function reset_transport_store(): void {
    transportStore.set({ ...defaultTransportState });
}

describe('restoreTransportSnapshot', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        reset_transport_store();
        vi.mocked(setMasterGainValue).mockClear();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('restores durable fields while resetting runtime fields from a legacy full transport state', () => {
        const legacy_snapshot = {
            ...defaultTransportState,
            isPlaying: true,
            isRecording: true,
            overdubEnabled: true,
            playheadPosition: 64,
            scheduleGrainMs: 1,
            tempo: 150,
            timeSignatureNumerator: 7,
            timeSignatureDenominator: 8,
            isLooping: true,
            loopStart: 4,
            loopEnd: 12,
            metronomeEnabled: true,
            metronomeVolume: 0.75,
            punchInEnabled: true,
            punchInBeat: 2,
            punchOutBeat: 10,
            countInEnabled: true,
            countInBars: 2,
            preRollEnabled: true,
            preRollBars: 3,
            masterGain: 95,
        } satisfies TransportState;

        restoreTransportSnapshot(legacy_snapshot);

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            tempo: 150,
            timeSignatureNumerator: 7,
            timeSignatureDenominator: 8,
            isLooping: true,
            loopStart: 4,
            loopEnd: 12,
            metronomeEnabled: true,
            metronomeVolume: 0.75,
            punchInEnabled: true,
            punchInBeat: 2,
            punchOutBeat: 10,
            countInEnabled: true,
            countInBars: 2,
            preRollEnabled: true,
            preRollBars: 3,
            masterGain: 95,
        });
        expect(setMasterGainValue).toHaveBeenCalledWith(0.95);
    });

    it('sanitizes malformed durable snapshots to the default transport state', () => {
        restoreTransportSnapshot({ tempo: 19 });

        expect(transportStore.value).toEqual(defaultTransportState);
        expect(setMasterGainValue).toHaveBeenCalledWith(defaultTransportState.masterGain / 100);
    });
});
