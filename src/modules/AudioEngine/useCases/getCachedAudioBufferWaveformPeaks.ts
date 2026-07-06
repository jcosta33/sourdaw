import { audioBufferCache } from '../stores/audioBufferCache';

type GetCachedAudioBufferWaveformPeaksInput = {
    bufferId: string;
    numBins: number;
    startSample?: number;
    endSample?: number;
};

type GetCachedAudioBufferWaveformPeaksOutput = Float32Array;

export function getCachedAudioBufferWaveformPeaks({
    bufferId,
    numBins,
    startSample,
    endSample,
}: GetCachedAudioBufferWaveformPeaksInput): GetCachedAudioBufferWaveformPeaksOutput {
    if (startSample === undefined && endSample === undefined) {
        return audioBufferCache.getWaveformPeaks(bufferId, numBins);
    }

    const window_opts: { startSample?: number; endSample?: number } = {};
    if (startSample !== undefined) {
        window_opts.startSample = startSample;
    }
    if (endSample !== undefined) {
        window_opts.endSample = endSample;
    }

    return audioBufferCache.getWaveformPeaks(bufferId, numBins, window_opts);
}
