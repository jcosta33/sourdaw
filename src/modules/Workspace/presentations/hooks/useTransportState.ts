/**
 * useTransportState — local re-implementation using transportStore (contract).
 */
import { useStore } from '#/infra/store/useStore';
import { transportStore, defaultTransportState } from '#/modules/Transport';

type TransportViewState = {
    isPlaying: boolean;
    isRecording: boolean;
    isLooping: boolean;
    overdubEnabled: boolean;
    metronomeEnabled: boolean;
    metronomeVolume: number;
    punchInEnabled: boolean;
    countInEnabled: boolean;
    countInBars: number;
    tempo: number;
    timeSignatureNumerator: number;
    timeSignatureDenominator: number;
};

export const useTransportState = (): TransportViewState => {
    return useStore(transportStore, defaultTransportState);
};
