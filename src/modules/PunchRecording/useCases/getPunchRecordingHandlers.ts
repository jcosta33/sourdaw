import { handleTogglePunchRecording } from '../handlers/punchRecording/handleTogglePunchRecording';

export type PunchRecordingHandlersMap = {
    togglePunchRecording: typeof handleTogglePunchRecording;
};

/**
 * Merges PunchRecording `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getPunchRecordingHandlers(): PunchRecordingHandlersMap {
    return {
        togglePunchRecording: handleTogglePunchRecording,
    };
}
