import { audioEngine } from '../../repositories/createWebAudioEngine';
import { readNativeEngineStripPeak } from '../livePlayback/readNativeEngineStripPeak';

/**
 * The level to show on a track strip's meter.
 *
 * Prefers the native engine's own reading for a strip it carries — a hosted
 * plugin generating into a strip the Web Audio graph gates out has no signal
 * for that graph's analyser to see, so the analyser reading would be a true
 * measurement of the wrong output. `??`, never `||`: a native reading of
 * exactly `0` (true digital silence) must not fall through to Web Audio's
 * number for a strip the native engine already answered for.
 */
export function getTrackPeakLevel(trackId: string): number {
    return readNativeEngineStripPeak(trackId) ?? audioEngine.getTrackPeakLevel(trackId);
}
