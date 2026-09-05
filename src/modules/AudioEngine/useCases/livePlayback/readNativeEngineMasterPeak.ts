import { nativeEnginePlayheadFeed } from './nativeEnginePlayheadFeedState';
import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

/**
 * What the native engine's master output measured, or `null` when nothing on
 * this side measured anything.
 *
 * The same audibility condition the playhead read applies, for the same
 * reason: a session whose monitor is shadowed writes true zeros at the device,
 * so its meter describes an output nobody is hearing, and showing it beside
 * the level a musician *is* hearing would put two unrelated numbers in one
 * readout.
 *
 * It does not require the transport to be rolling, and that is the one place
 * it parts company with the playhead read. A parked audible session still
 * carries the device: it renders silence, and silence is a measured zero — a
 * true statement about the output — where a parked engine's *position* is not
 * a position the mix is at. `null` is reserved for the cases where this side
 * measured nothing at all: no feed, no reading, an engine that is not running,
 * or a session that is not the audible carrier.
 */
export function readNativeEngineMasterPeak(): number | null {
    if (!nativeEnginePlayheadFeed.running || !nativeLiveGraphSession.audibleCarrier) {
        return null;
    }
    const reading = nativeEnginePlayheadFeed.reading;
    if (!reading?.running) {
        return null;
    }
    return reading.masterPeak;
}
