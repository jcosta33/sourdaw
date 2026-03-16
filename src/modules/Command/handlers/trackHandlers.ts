import type { ActionHandler } from "../models/ActionHandler";
import type { AppAction } from "../models/AppAction";
import { addTrack } from "#/modules/Track/useCases/addTrack";
import { removeTrack } from "#/modules/Track/useCases/removeTrack";
import { renameTrack } from "#/modules/Track/useCases/renameTrack";
import { muteTrack, soloTrack, clearSolos, selectTrack, reorderTrack, hideTrack, disableTrack, setTrackHeight, setTrackOutput, setAutomationMode, foldTrack, groupTracks, ungroupTracks, toggleSoloSafe } from "#/modules/Track/useCases/toggleTrackState";
import { armTrack } from "#/modules/Track/useCases/recordingUseCases";
import { freezeTrack, unfreezeTrack, bounceInPlace, bounceToNewTrack } from "#/modules/Track/useCases/freezeBounce";
import { duplicateTrack } from "#/modules/Track/useCases/duplicateTrack";
import { createFolder } from "#/modules/Track/useCases/folderUseCases";
import { setTrackGain, setTrackPan, setTrackColor, setTrackNotes } from "#/modules/Track/useCases/setTrackGainPan";
import { zoomTracksVertical } from "#/modules/Track/useCases/trackZoom";
import { audioEngine } from "#/modules/AudioEngine/repositories/audioEngineInstance";
import { trackStore } from "#/modules/Track/stores/trackStore";

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const trackHandlers = {
    addTrack: {
        execute: (a) => { addTrack(a.payload); },
        describe: (a) => ({ label: `Add ${a.payload.kind} track "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "addTrack">>,

    removeTrack: {
        execute: (a) => { removeTrack(a.payload.trackId); },
        describe: () => ({ label: "Remove track" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "removeTrack">>,

    renameTrack: {
        execute: (a) => { renameTrack(a.payload.trackId, a.payload.name); },
        describe: (a) => ({ label: `Rename track to "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "renameTrack">>,

    selectTrack: {
        execute: (a) => { selectTrack(a.payload.trackId); },
        describe: () => ({ label: "Select track" }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, "selectTrack">>,

    muteTrack: {
        execute: (a) => { muteTrack(a.payload.trackId, a.payload.muted); },
        describe: (a) => ({
            label: a.payload.muted ? "Mute track" : "Unmute track",
            inverseAction: { type: "muteTrack", payload: { trackId: a.payload.trackId, muted: !a.payload.muted } },
        }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "muteTrack">>,

    soloTrack: {
        execute: (a) => { soloTrack(a.payload.trackId, a.payload.soloed); },
        describe: (a) => ({
            label: a.payload.soloed ? "Solo track" : "Unsolo track",
            inverseAction: { type: "soloTrack", payload: { trackId: a.payload.trackId, soloed: !a.payload.soloed } },
        }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "soloTrack">>,

    armTrack: {
        execute: (a) => { armTrack(a.payload.trackId, a.payload.armed); },
        describe: (a) => ({ label: a.payload.armed ? "Arm track" : "Disarm track" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "armTrack">>,

    freezeTrack: {
        execute: async (a) => { await freezeTrack(a.payload.trackId); },
        describe: () => ({ label: "Freeze track" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "freezeTrack">>,

    unfreezeTrack: {
        execute: (a) => { unfreezeTrack(a.payload.trackId); },
        describe: () => ({ label: "Unfreeze track" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "unfreezeTrack">>,

    bounceInPlace: {
        execute: (a) => { bounceInPlace(a.payload.trackId); },
        describe: () => ({ label: "Bounce in place" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "bounceInPlace">>,

    duplicateTrack: {
        execute: (a) => { duplicateTrack(a.payload.trackId); },
        describe: () => ({ label: "Duplicate track" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "duplicateTrack">>,

    reorderTrack: {
        execute: (a) => { reorderTrack(a.payload.trackId, a.payload.newIndex); },
        describe: () => ({ label: "Reorder track" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "reorderTrack">>,

    setTrackGain: {
        execute: (a) => {
            setTrackGain(a.payload.trackId, a.payload.gain);
            audioEngine.setTrackGain(a.payload.trackId, a.payload.gain);
        },
        describe: (a) => {
            const prev = trackStore.value?.tracks.find((t) => t.id === a.payload.trackId);
            return {
                label: "Set track gain",
                inverseAction: prev ? { type: "setTrackGain", payload: { trackId: a.payload.trackId, gain: prev.gain } } : null,
            };
        },
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "setTrackGain">>,

    setTrackPan: {
        execute: (a) => {
            setTrackPan(a.payload.trackId, a.payload.pan);
            audioEngine.setTrackPan(a.payload.trackId, a.payload.pan);
        },
        describe: (a) => {
            const prev = trackStore.value?.tracks.find((t) => t.id === a.payload.trackId);
            return {
                label: "Set track pan",
                inverseAction: prev ? { type: "setTrackPan", payload: { trackId: a.payload.trackId, pan: prev.pan } } : null,
            };
        },
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "setTrackPan">>,

    setTrackColor: {
        execute: (a) => {
            setTrackColor(a.payload.trackId, a.payload.color);
        },
        describe: (a) => {
            const prev = trackStore.value?.tracks.find((t) => t.id === a.payload.trackId);
            return {
                label: "Set track color",
                inverseAction: prev ? { type: "setTrackColor", payload: { trackId: a.payload.trackId, color: prev.color } } : null,
            };
        },
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "setTrackColor">>,

    createBus: {
        execute: (a) => { addTrack({ name: a.payload.name, kind: "bus" }); },
        describe: (a) => ({ label: `Create bus "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "createBus">>,

    createFolder: {
        execute: (a) => { createFolder(a.payload.name); },
        describe: (a) => ({ label: `Create folder "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "createFolder">>,

    hideTrack: {
        execute: (a) => { hideTrack(a.payload.trackId, a.payload.hidden); },
        describe: (a) => ({ label: a.payload.hidden ? "Hide track" : "Show track" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "hideTrack">>,

    disableTrack: {
        execute: (a) => { disableTrack(a.payload.trackId, a.payload.disabled); },
        describe: (a) => ({ label: a.payload.disabled ? "Disable track" : "Enable track" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "disableTrack">>,

    setTrackHeight: {
        execute: (a) => { setTrackHeight(a.payload.trackId, a.payload.height); },
        describe: () => ({ label: "Set track height" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "setTrackHeight">>,

    setTrackOutput: {
        execute: (a) => { setTrackOutput(a.payload.trackId, a.payload.outputId); },
        describe: () => ({ label: "Set track output" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "setTrackOutput">>,

    setAutomationMode: {
        execute: (a) => { setAutomationMode(a.payload.trackId, a.payload.mode); },
        describe: (a) => ({ label: `Set automation mode: ${a.payload.mode}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "setAutomationMode">>,

    foldTrack: {
        execute: (a) => { foldTrack(a.payload.trackId, a.payload.folded); },
        describe: (a) => ({ label: a.payload.folded ? "Fold track" : "Unfold track" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "foldTrack">>,

    groupTracks: {
        execute: (a) => { groupTracks(a.payload.trackIds, a.payload.name); },
        describe: (a) => ({ label: `Group tracks: "${a.payload.name}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "groupTracks">>,

    ungroupTracks: {
        execute: (a) => { ungroupTracks(a.payload.groupId); },
        describe: () => ({ label: "Ungroup tracks" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "ungroupTracks">>,

    toggleSoloSafe: {
        execute: (a) => { toggleSoloSafe(a.payload.trackId); },
        describe: () => ({ label: "Toggle solo safe" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "toggleSoloSafe">>,

    setTrackNotes: {
        execute: (a) => { setTrackNotes(a.payload.trackId, a.payload.notes); },
        describe: () => {
            return { label: "Set track notes" };
        },
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "setTrackNotes">>,

    clearSolos: {
        execute: () => { clearSolos(); },
        describe: () => ({ label: "Clear all solos" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "clearSolos">>,

    zoomTracksVertical: {
        execute: (a) => { zoomTracksVertical(a.payload.delta); },
        describe: (a) => ({ label: `Zoom tracks vertical ${a.payload.delta > 0 ? "in" : "out"}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "zoomTracksVertical">>,

    consolidateAllTracks: {
        execute: async () => {
            const state = trackStore.value;
            if (!state) return;
            for (const track of state.tracks) {
                if ((track.kind === "audio" || track.kind === "midi") && track.clips.length > 0) {
                    await bounceInPlace(track.id);
                }
            }
        },
        describe: () => ({ label: "Consolidate all tracks" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "consolidateAllTracks">>,

    bounceToNewTrack: {
        execute: async (a) => { await bounceToNewTrack(a.payload.trackId); },
        describe: () => ({ label: "Bounce to new track" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "bounceToNewTrack">>,
};
