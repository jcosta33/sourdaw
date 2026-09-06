import { nativeEnginePlayheadFeed } from './nativeEnginePlayheadFeedState';
import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

/**
 * Where the native engine's transport stands, or `null` when nothing should be
 * drawn from it.
 *
 * A cursor must follow the engine that is making the sound. A native live
 * session runs with its monitor shadowed, so its engine contributes true zeros
 * at the device and Web Audio is what a musician hears; its stream also opens
 * some way into the take, so its playhead sits behind the audible one by
 * however long the device took to start. Drawing the cursor from it in that
 * state would show a position the mix is not at.
 *
 * `nativeLiveGraphSession.audibleCarrier` is that condition. It is the
 * conjunction of both halves — a topology that carries at least one strip the
 * engine was told to sound, and a monitor that is open — so a session that
 * carries a whole project behind a shadowed monitor keeps the cursor on Web
 * Audio, and the cutover moves it with nothing to remember to switch on.
 *
 * `null` therefore covers every case in which the engine's position is not the
 * position a musician is hearing: no feed, no engine, an engine that is not
 * rolling, and a session that is not the audible carrier.
 */
export function readNativeEnginePlayheadSeconds(): number | null {
    if (!nativeEnginePlayheadFeed.running || !nativeLiveGraphSession.audibleCarrier) {
        return null;
    }
    const reading = nativeEnginePlayheadFeed.reading;
    if (!reading?.running || !reading.playing) {
        return null;
    }
    return reading.positionSeconds;
}
