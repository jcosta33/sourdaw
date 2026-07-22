import { activeRecording, touchActive } from './recordingSessionState';

type RecordingAutomationMode = 'read' | 'write' | 'touch' | 'latch' | 'off' | undefined;

export function isRecordingAutomationByKey(key: string, automationMode: RecordingAutomationMode): boolean {
    const session = activeRecording.get(key);
    if (!session || !automationMode) {
        return false;
    }
    if (automationMode === 'write') {
        return true;
    }
    if (automationMode === 'touch') {
        return touchActive.has(key);
    }
    if (automationMode === 'latch') {
        return touchActive.has(key) || session.lastValue !== null;
    }
    return false;
}
