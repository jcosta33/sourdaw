import { recordingMidiBound } from './recordingMidiBound';

/** Only this exact automatic admission can owe a surviving MIDI ending. */
export function hasAutomaticRecordingMidiCapture(
    provider: Parameters<typeof recordingMidiBound.hasMidiCapture>[0]
): boolean {
    return recordingMidiBound.hasMidiCapture(provider);
}
