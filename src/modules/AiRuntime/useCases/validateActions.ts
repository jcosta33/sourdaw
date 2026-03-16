import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import type { AppAction, AppActionType } from "#/modules/Command/models/AppAction";

const logger = Container.getInstance().get(Logger);

const KNOWN_ACTION_TYPES: ReadonlySet<AppActionType> = new Set<AppActionType>([
    "addTrack", "removeTrack", "renameTrack", "selectTrack",
    "muteTrack", "soloTrack", "toggleSoloSafe", "armTrack",
    "freezeTrack", "unfreezeTrack", "bounceInPlace",
    "duplicateTrack", "reorderTrack",
    "setTrackGain", "setTrackPan", "setTrackColor",
    "setTempo", "togglePlayback", "stopPlayback", "toggleRecording",
    "setMasterGain", "toggleLoop", "toggleMetronome", "setMetronomeVolume", "setLoopRegion",
    "addClip", "moveClip", "duplicateClip", "duplicateClipToNextBar", "removeClip", "splitClip",
    "trimClipStart", "trimClipEnd", "setClipFade",
    "copyClip", "cutClip", "pasteClip",
    "addDevice", "bypassDevice", "removeDevice", "setDeviceParameter",
    "createBus", "createFolder", "setSend",
    "setWorkspaceMode", "openMixer", "closeMixer",
    "toggleSidebar", "toggleInspector", "setEditingTool",
    "addMarker", "removeMarker", "setMarkerColor",
    "addSection", "removeSection", "renameSection",
    "addAutomationLane", "addAutomationPoint",
    "quantizeNotes", "quantizeNoteLengths", "transposeNotes", "humanizeNotes",
    "invertNotes", "retrogradeNotes",
    "scaleVelocities", "scaleAllVelocities", "setAllVelocities",
    "importMidiFile",
    "normalizeClip", "reverseClip", "glueClips", "nudgeClip", "crossfadeClips", "setClipGain", "setClipColor", "lockClip", "renameClip",
    "consolidateSelection", "bounceSelection", "seekPlayhead",
    "setPunchIn", "setPunchOut", "togglePunch", "toggleCountIn", "setCountInBars",
    "togglePreRoll", "setPreRollBars",
    "addTimeSignatureChange", "removeTimeSignatureChange",
    "setTrackOutput", "addSend", "removeSend",
    "removeAutomationPoint", "setAutomationMode", "hideTrack", "disableTrack", "setTrackHeight",
    "setSnapValue", "zoomToFit", "zoomToSelection", "exportProject", "saveProject", "newProject", "importAudioFile", "exportMidi",
    "foldTrack", "groupTracks", "ungroupTracks",
    "scaleAutomation", "stretchAutomation", "invertAutomation", "reverseAutomation", "thinAutomation", "quantizeAutomation",
    "loadPreset", "savePreset",
    "generateDrumPattern", "generateMelody", "generateChordProgression",
    "setClipLoop", "setClipLoopLength", "extractGroove", "applyGroove",
    "setClipStretchMode", "setClipStretchRatio", "fitClipToBeats",
    "analyzeMix", "autoFixMix",
    "enableMpe", "disableMpe", "getLatencyReport",
    "createCollabSession", "joinCollabSession", "leaveCollabSession",
    "scanPlugins", "loadExternalPlugin", "audioToMidi",
    "muteClip", "clearSolos",
    "setTrackNotes",
    "zoomTracksVertical",
    "deleteTime", "insertTime", "duplicateTimeRange", "stripSilence",
    "detectTempo", "detectKey",
    "consolidateAllTracks",
    "arpeggiate",
    "addSidechainRoute",
    "removeSidechainRoute",
    "bounceToNewTrack",
]);

export const validateActions = (actions: AppAction[]): AppAction[] => {
    return actions.filter((action) => {
        if (!KNOWN_ACTION_TYPES.has(action.type)) {
            logger.warn(`Unknown action type rejected: ${action.type}`);
            return false;
        }

        if (action.type === "setTempo") {
            const bpm = action.payload.bpm;
            if (bpm < 20 || bpm > 300) {
                logger.warn(`Invalid tempo rejected: ${bpm}`);
                return false;
            }
        }

        if (action.type === "setMasterGain") {
            const gain = action.payload.gain;
            if (gain < 0 || gain > 1) {
                logger.warn(`Invalid gain rejected: ${gain}`);
                return false;
            }
        }

        if (action.type === "setMetronomeVolume") {
            const volume = action.payload.volume;
            if (volume < 0 || volume > 1) {
                logger.warn(`Invalid metronome volume rejected: ${volume}`);
                return false;
            }
        }

        return true;
    });
};
