import { nativeEnginePlayheadFeed } from './nativeEnginePlayheadFeedState';
import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

/**
 * What the native engine measured for one track strip, or `null` when this
 * side has nothing trustworthy to say about that strip.
 *
 * The same audibility condition {@link readNativeEngineMasterPeak} applies,
 * for the same reason: a session whose monitor is shadowed writes true zeros
 * at the device, so its meter describes an output nobody is hearing. On top
 * of that this strip must be one the session actually claimed — the engine's
 * registry carries a peak for every strip it knows about, carried or not, so
 * a strip Web Audio still owns audio for would otherwise read a stale or
 * silent native number instead of the level the musician can actually hear.
 *
 * `null` is reserved for the cases where this side measured nothing usable
 * for this strip at all: no feed, no reading, an engine that is not running,
 * a session that is not the audible carrier, or a strip this session never
 * claimed as carried.
 */
export function readNativeEngineStripPeak(trackId: string): number | null {
    if (!nativeEnginePlayheadFeed.running || !nativeLiveGraphSession.audibleCarrier) {
        return null;
    }
    if (!nativeLiveGraphSession.carriedStripIds.has(trackId)) {
        return null;
    }
    const reading = nativeEnginePlayheadFeed.reading;
    if (!reading?.running) {
        return null;
    }
    return reading.stripPeaks[trackId] ?? null;
}
