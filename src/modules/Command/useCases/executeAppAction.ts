import type { AppAction } from "../models/AppAction";
import { createUndoEntry } from "../models/UndoEntry";
import { pushUndo } from "../stores/undoStore";
import { addTrack } from "#/modules/Track/useCases/addTrack";
import { removeTrack } from "#/modules/Track/useCases/removeTrack";
import { renameTrack } from "#/modules/Track/useCases/renameTrack";
import { muteTrack, soloTrack, selectTrack } from "#/modules/Track/useCases/toggleTrackState";
import { addClip, removeClip, moveClip, duplicateClip } from "#/modules/Track/useCases/clipUseCases";
import { splitClip } from "#/modules/Track/useCases/clipEditingUseCases";
import { addDevice, removeDevice, bypassDevice, setSend } from "#/modules/Track/useCases/deviceUseCases";
import { armTrack } from "#/modules/Track/useCases/recordingUseCases";
import { freezeTrack, unfreezeTrack, bounceInPlace } from "#/modules/Track/useCases/freezeBounce";
import { createFolder } from "#/modules/Track/useCases/folderUseCases";
import { quantizeNotes, transposeNotes, humanizeNotes } from "#/modules/Track/useCases/midiUseCases";
import { setTempo } from "#/modules/Transport/useCases/setTempo";
import { togglePlayback, stopPlayback, toggleLoop, toggleMetronome, toggleRecording } from "#/modules/Transport/useCases/transportControls";
import { setMasterGain } from "#/modules/AudioEngine/useCases/setMasterGain";
import { setWorkspaceMode } from "#/modules/Workspace/useCases/setWorkspaceMode";
import { toggleMixer } from "#/modules/Workspace/useCases/togglePanel";
import { addMarker, removeMarker } from "#/modules/Timeline/useCases/markerUseCases";

const NON_UNDOABLE: Set<string> = new Set([
    "togglePlayback", "stopPlayback", "toggleRecording",
    "setWorkspaceMode", "openMixer", "closeMixer", "selectTrack",
]);

export const executeAppAction = async (action: AppAction): Promise<void> => {
    let label: string = action.type;
    let inverseAction: AppAction | null = null;

    switch (action.type) {
        case "addTrack":
            addTrack(action.payload);
            label = `Add ${action.payload.kind} track "${action.payload.name}"`;
            break;
        case "removeTrack":
            removeTrack(action.payload.trackId);
            label = "Remove track";
            break;
        case "renameTrack":
            renameTrack(action.payload.trackId, action.payload.name);
            label = `Rename track to "${action.payload.name}"`;
            break;
        case "selectTrack":
            selectTrack(action.payload.trackId);
            break;
        case "muteTrack":
            muteTrack(action.payload.trackId, action.payload.muted);
            label = action.payload.muted ? "Mute track" : "Unmute track";
            inverseAction = { type: "muteTrack", payload: { trackId: action.payload.trackId, muted: !action.payload.muted } };
            break;
        case "soloTrack":
            soloTrack(action.payload.trackId, action.payload.soloed);
            label = action.payload.soloed ? "Solo track" : "Unsolo track";
            inverseAction = { type: "soloTrack", payload: { trackId: action.payload.trackId, soloed: !action.payload.soloed } };
            break;
        case "armTrack":
            armTrack(action.payload.trackId, action.payload.armed);
            label = action.payload.armed ? "Arm track" : "Disarm track";
            break;
        case "freezeTrack":
            freezeTrack(action.payload.trackId);
            label = "Freeze track";
            break;
        case "unfreezeTrack":
            unfreezeTrack(action.payload.trackId);
            label = "Unfreeze track";
            break;
        case "bounceInPlace":
            bounceInPlace(action.payload.trackId);
            label = "Bounce in place";
            break;
        case "addClip":
            addClip(action.payload);
            label = `Add clip "${action.payload.name}"`;
            break;
        case "moveClip":
            moveClip(action.payload.clipId, action.payload.trackId, action.payload.startBeat);
            label = "Move clip";
            break;
        case "duplicateClip":
            duplicateClip(action.payload.clipId);
            label = "Duplicate clip";
            break;
        case "removeClip":
            removeClip(action.payload.clipId);
            label = "Remove clip";
            break;
        case "splitClip":
            splitClip(action.payload.clipId, action.payload.beat);
            label = "Split clip";
            break;
        case "addDevice":
            addDevice(action.payload.trackId, action.payload.deviceType);
            label = `Add ${action.payload.deviceType}`;
            break;
        case "bypassDevice":
            bypassDevice(action.payload.deviceId, action.payload.bypassed);
            label = action.payload.bypassed ? "Bypass device" : "Enable device";
            break;
        case "removeDevice":
            removeDevice(action.payload.deviceId);
            label = "Remove device";
            break;
        case "setSend":
            setSend(action.payload.trackId, action.payload.busId, action.payload.level);
            label = "Set send level";
            break;
        case "setTempo":
            setTempo(action.payload.bpm);
            label = `Set tempo to ${action.payload.bpm} BPM`;
            break;
        case "togglePlayback":
            togglePlayback();
            break;
        case "stopPlayback":
            stopPlayback();
            break;
        case "toggleRecording":
            toggleRecording();
            break;
        case "setMasterGain":
            setMasterGain(action.payload.gain);
            label = `Set master gain`;
            break;
        case "toggleLoop":
            toggleLoop();
            label = "Toggle loop";
            break;
        case "toggleMetronome":
            toggleMetronome();
            label = "Toggle metronome";
            break;
        case "setWorkspaceMode":
            setWorkspaceMode(action.payload.mode);
            break;
        case "openMixer":
        case "closeMixer":
            toggleMixer();
            break;
        case "createBus":
            addTrack({ name: action.payload.name, kind: "bus" });
            label = `Create bus "${action.payload.name}"`;
            break;
        case "createFolder":
            createFolder(action.payload.name);
            label = `Create folder "${action.payload.name}"`;
            break;
        case "addMarker":
            addMarker(action.payload.beat, action.payload.name);
            label = `Add marker "${action.payload.name}"`;
            break;
        case "removeMarker":
            removeMarker(action.payload.markerId);
            label = "Remove marker";
            break;
        case "quantizeNotes":
            quantizeNotes(action.payload.clipId, action.payload.gridSize);
            label = "Quantize notes";
            break;
        case "transposeNotes":
            transposeNotes(action.payload.clipId, action.payload.semitones);
            label = `Transpose ${action.payload.semitones > 0 ? "+" : ""}${action.payload.semitones} semitones`;
            break;
        case "humanizeNotes":
            humanizeNotes(action.payload.clipId, action.payload.amount);
            label = "Humanize notes";
            break;
        default: {
            const _exhaustive: never = action;
            console.warn("Unhandled action:", _exhaustive);
            return;
        }
    }

    if (!NON_UNDOABLE.has(action.type)) {
        pushUndo(createUndoEntry(label, action, inverseAction));
    }
};
