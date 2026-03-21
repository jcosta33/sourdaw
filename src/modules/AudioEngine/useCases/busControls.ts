/**
 * Use case for bus and send management.
 *
 * Handles bus strip creation, gain, and send routing between tracks and buses.
 */
import { audioEngine } from '../repositories/audioEngineInstance';
import { type BusStrip } from '../models/AudioEngineState';

export const ensureBusStrip = (busId: string): BusStrip => {
    return audioEngine.ensureBusStrip(busId);
};

export const setBusGain = (busId: string, gain: number): void => {
    audioEngine.setBusGain(busId, gain);
};

export const setSend = (sourceTrackId: string, busId: string, level: number, preFader = false): void => {
    audioEngine.setSend(sourceTrackId, busId, level, preFader);
};
