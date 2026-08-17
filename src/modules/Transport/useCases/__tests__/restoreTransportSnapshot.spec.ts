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

    it('sanitizes a fully malformed durable snapshot to the default transport state', () => {
        restoreTransportSnapshot({ tempo: 19 });

        expect(transportStore.value).toEqual(defaultTransportState);
        expect(setMasterGainValue).toHaveBeenCalledWith(defaultTransportState.masterGain / 100);
    });

    it('resets only the invalid field and preserves the other valid durable field (per-field contract, not the retired full-state collapse)', () => {
        restoreTransportSnapshot({ tempo: 19, masterGain: 90 });

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            tempo: defaultTransportState.tempo,
            masterGain: 90,
        });
        expect(setMasterGainValue).toHaveBeenCalledWith(0.9);
    });

    it('resets the full loop trio for a fabricated region instead of only the rejected member', () => {
        restoreTransportSnapshot({ isLooping: true, loopStart: -1, loopEnd: 16 });

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            isLooping: defaultTransportState.isLooping,
            loopStart: defaultTransportState.loopStart,
            loopEnd: defaultTransportState.loopEnd,
        });
        expect(setMasterGainValue).toHaveBeenCalledWith(defaultTransportState.masterGain / 100);
    });
});
