/**
 * Use case for accessing core AudioEngine state and lifecycle.
 *
 * Provides the AudioContext, engine state, master gain, and metering.
 * This is the primary entry point for modules needing engine context.
 */
import { audioEngine } from '../repositories/createWebAudioEngine';
import { type AudioEngineState } from '../models/AudioEngineState';

export const getAudioContext = (): AudioContext => {
    return audioEngine.context;
};

export const getAudioEngine = () => audioEngine;

export const getEngineState = (): AudioEngineState => {
    return audioEngine.getState();
};

export const resumeEngine = (): Promise<void> => {
    return audioEngine.resume();
};

export const waitForDevices = (): Promise<void> => {
    return audioEngine.waitForDevices();
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

export const getAudioSampleRate = (): number => {
    return audioEngine.context?.sampleRate ?? 44100;
};

export const getTrackStripAnalyser = (trackId: string): AnalyserNode | null => {
    return audioEngine.getTrackStrip(trackId)?.analyserNode ?? null;
};

// ─── Bus operations ────────────────────────────────────────────────────────────

export const ensureBusStrip = (busId: string): void => {
    audioEngine.ensureBusStrip(busId);
};

export const setBusGain = (busId: string, gain: number): void => {
    audioEngine.setBusGain(busId, gain);
};

export const setSend = (sourceTrackId: string, busId: string, level: number, preFader: boolean): void => {
    audioEngine.setSend(sourceTrackId, busId, level, preFader);
};

// ─── Sidechain operations ──────────────────────────────────────────────────────

export const wireSidechainRoute = (sourceTrackId: string, targetTrackId: string, targetDeviceId: string): void => {
    audioEngine.wireSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId);
};

export const unwireSidechainRoute = (sourceTrackId: string, targetDeviceId: string): void => {
    audioEngine.unwireSidechainRoute(sourceTrackId, targetDeviceId);
};

// ─── Link (Ableton Link) operations ────────────────────────────────────────────

export { enableLink, disableLink, getLinkStatus } from '../repositories/linkBridge';
