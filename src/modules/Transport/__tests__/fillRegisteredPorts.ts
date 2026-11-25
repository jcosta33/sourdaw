import { setGestureClockSource } from '../stores/gestureClockSource';
import { playheadClockRef } from '../stores/playheadClockRef';

// No audio time elapses past the scheduler's committed anchor, so a capture answers the anchor beat.
setGestureClockSource({
    getAudioTimeSeconds: () => playheadClockRef.audioTimeSeconds,
    readNativeCursorBeats: () => null,
});
