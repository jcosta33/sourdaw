import type { AppAction, AppActionType } from "#/modules/Command/models/AppAction";

const KNOWN_ACTION_TYPES: ReadonlySet<AppActionType> = new Set<AppActionType>([
    "addTrack", "removeTrack", "renameTrack", "selectTrack",
    "muteTrack", "soloTrack", "armTrack",
    "freezeTrack", "unfreezeTrack", "bounceInPlace",
    "setTempo", "togglePlayback", "stopPlayback", "toggleRecording",
    "setMasterGain", "toggleLoop", "toggleMetronome",
    "addClip", "moveClip", "duplicateClip", "removeClip", "splitClip",
    "addDevice", "bypassDevice", "removeDevice",
    "createBus", "createFolder", "setSend",
    "setWorkspaceMode", "openMixer", "closeMixer",
    "addMarker", "removeMarker",
    "quantizeNotes", "transposeNotes", "humanizeNotes",
]);

export const validateActions = (actions: AppAction[]): AppAction[] => {
    return actions.filter((action) => {
        if (!KNOWN_ACTION_TYPES.has(action.type)) {
            console.warn(`Unknown action type rejected: ${action.type}`);
            return false;
        }

        if (action.type === "setTempo") {
            const bpm = action.payload.bpm;
            if (bpm < 20 || bpm > 300) {
                console.warn(`Invalid tempo rejected: ${bpm}`);
                return false;
            }
        }

        if (action.type === "setMasterGain") {
            const gain = action.payload.gain;
            if (gain < 0 || gain > 1) {
                console.warn(`Invalid gain rejected: ${gain}`);
                return false;
            }
        }

        return true;
    });
};
