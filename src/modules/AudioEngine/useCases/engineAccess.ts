/**
 * Use case for accessing core AudioEngine state and lifecycle.
 *
 * Provides the AudioContext, engine state, master gain, and metering.
 * This is the primary entry point for modules needing engine context.
 */
import { audioEngine } from '../repositories/createWebAudioEngine';
import { type AudioEngineState } from '../models/AudioEngineState';

export function getAudioContext(): AudioContext {
    return audioEngine.context;
}

export function getEngineState(): AudioEngineState {
    return audioEngine.getState();
}

export function resumeEngine(): Promise<void> {
    return audioEngine.resume();
}

export function waitForDevices(): Promise<void> {
    return audioEngine.waitForDevices();
}

export function resetAudioGraph(): void {
    audioEngine.resetGraph();
}

export function getMasterAnalyser(): AnalyserNode {
    return audioEngine.masterAnalyser;
}

export function getMasterPeakLevel(): number {
    return audioEngine.getMasterPeakLevel();
}

export function setMasterGainValue(value: number): void {
    audioEngine.setMasterGain(value);
}

export function getAudioSampleRate(): number {
    return audioEngine.context?.sampleRate ?? 44100;
}

export function getTrackAnalyser(trackId: string): AnalyserNode | null {
    return audioEngine.getTrackStrip(trackId)?.analyserNode ?? null;
}

export function getTrackStrip(trackId: string) {
    return audioEngine.getTrackStrip(trackId);
}

export function ensureTrackStrip(trackId: string) {
    return audioEngine.ensureTrackStrip(trackId);
}

export function getAudioTime(): number {
    return audioEngine.context?.currentTime ?? 0;
}

// ─── Bus operations ────────────────────────────────────────────────────────────

export function ensureBusStrip(busId: string): void {
    audioEngine.ensureBusStrip(busId);
}

export function setBusGain(busId: string, gain: number): void {
    audioEngine.setBusGain(busId, gain);
}

export function setSend(sourceTrackId: string, busId: string, level: number, preFader: boolean): void {
    audioEngine.setSend(sourceTrackId, busId, level, preFader);
}

// ─── Sidechain operations ──────────────────────────────────────────────────────

export function wireSidechainRoute(sourceTrackId: string, targetTrackId: string, targetDeviceId: string): void {
    audioEngine.wireSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId);
}

export function unwireSidechainRoute(sourceTrackId: string, targetDeviceId: string): void {
    audioEngine.unwireSidechainRoute(sourceTrackId, targetDeviceId);
}

// ─── Link (Ableton Link) operations ────────────────────────────────────────────

export { enableLink, disableLink, getLinkStatus } from '../repositories/linkBridge';
