import { nativeEnginePlayheadFeed } from './nativeEnginePlayheadFeedState';
import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

/**
 * Where the native engine's transport stands, or `null` when nothing should be
 * drawn from it.
 *
 * A cursor must follow the engine that is making the sound. The native live
 * session's topology carries no clips yet (see `projectLiveGraphTopology`), so
 * the engine renders silence and Web Audio is what a musician hears; its stream
 * also opens some way into the take, so its playhead sits behind the audible
 * one by however long the device took to start. Drawing the cursor from it in
 * that state would show a position the mix is not at.
 *
 * `nativeLiveGraphSession.carriesAudio` is that condition, and it is derived
 * from the batch actually sent rather than declared — so the cursor starts
 * following the engine on the first run whose topology carries audio, with
 * nothing to remember to switch on.
 *
 * `null` therefore covers every case in which the engine's position is not the
 * position a musician is hearing: no feed, no engine, an engine that is not
 * rolling, and a session whose topology carries no audio.
 */
export function readNativeEnginePlayheadSeconds(): number | null {
    if (!nativeEnginePlayheadFeed.running || !nativeLiveGraphSession.carriesAudio) {
        return null;
    }
    const reading = nativeEnginePlayheadFeed.reading;
    if (!reading?.running || !reading.playing) {
        return null;
    }
    return reading.positionSeconds;
}
