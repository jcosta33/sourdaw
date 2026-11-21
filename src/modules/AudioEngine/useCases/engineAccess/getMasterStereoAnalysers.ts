import { audioEngine } from '../../repositories/createWebAudioEngine';

export type MasterStereoAnalysers = {
    left: AnalyserNode;
    right: AnalyserNode;
};

/**
 * The engine's genuine left/right analysis tap (see {@link AudioEngine}).
 * Unlike {@link getMasterAnalyser}, whose time-domain data is always
 * down-mixed to mono per the Web Audio spec, these two nodes read one real
 * channel each — the only source that can answer a stereo question such as
 * "are these channels in phase".
 */
export function getMasterStereoAnalysers(): MasterStereoAnalysers {
    return { left: audioEngine.masterAnalyserLeft, right: audioEngine.masterAnalyserRight };
}
