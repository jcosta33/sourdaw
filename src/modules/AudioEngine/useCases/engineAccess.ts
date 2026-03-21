/**
 * Use case for accessing core AudioEngine state and lifecycle.
 *
 * Provides the AudioContext, engine state, master gain, and metering.
 * This is the primary entry point for modules needing engine context.
 */
import { audioEngine } from '../repositories/audioEngineInstance';
import { type AudioEngineState } from '../models/AudioEngineState';

export const getAudioContext = (): AudioContext => {
    return audioEngine.context;
};

export const getEngineState = (): AudioEngineState => {
    return audioEngine.getState();
};

export const resumeEngine = (): Promise<void> => {
    return audioEngine.resume();
};

export const getMasterAnalyser = (): AnalyserNode => {
    return audioEngine.masterAnalyser;
};

export const getMasterPeakLevel = (): number => {
    return audioEngine.getMasterPeakLevel();
};

export const setMasterGainValue = (value: number): void => {
    audioEngine.setMasterGain(value);
};
