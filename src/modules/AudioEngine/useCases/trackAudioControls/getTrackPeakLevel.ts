import { audioEngine } from '../../repositories/createWebAudioEngine';
import { createMeterFrameReader } from '../engineAccess/createMeterFrameReader';
import { readNativeEngineStripPeak } from '../livePlayback/readNativeEngineStripPeak';

const readFrame = createMeterFrameReader(
    (trackId: string) => readNativeEngineStripPeak(trackId) ?? audioEngine.getTrackPeakLevel(trackId)
);

/**
 * The level to show on a track strip's meter.
 *
 * Prefers the native engine's own reading for a strip it carries — a hosted
 * plugin generating into a strip the Web Audio graph gates out has no signal
 * for that graph's analyser to see, so the analyser reading would be a true
 * measurement of the wrong output. `??`, never `||`: a native reading of
 * exactly `0` (true digital silence) must not fall through to Web Audio's
 * number for a strip the native engine already answered for.
 * Omit frameTime for an immediate read; UI consumers pass their scheduler's RAF timestamp.
 */
export function getTrackPeakLevel(trackId: string, frameTime?: DOMHighResTimeStamp): number {
    return readFrame(trackId, frameTime);
}
