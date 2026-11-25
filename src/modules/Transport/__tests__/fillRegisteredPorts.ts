import { setGestureClockSource } from '../stores/gestureClockSource';

setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => null });
