import { recordingStartStore } from './recordingStartStore';
import { transportStore } from './transportStore';

/**
 * True while a recording is running, starting (count-in, pre-roll, admission pending)
 * or closing. Plain playback is not a recording. Readable from handlers, which cannot
 * import Transport's use cases.
 */
export function readRecordingEngaged(): boolean {
    return transportStore.value?.isRecording === true || recordingStartStore.value === true;
}
