export type AppAction =
    | { type: "addTrack"; payload: { name: string; kind: TrackKind } }
    | { type: "removeTrack"; payload: { trackId: string } }
    | { type: "renameTrack"; payload: { trackId: string; name: string } }
    | { type: "selectTrack"; payload: { trackId: string } }
    | { type: "muteTrack"; payload: { trackId: string; muted: boolean } }
    | { type: "soloTrack"; payload: { trackId: string; soloed: boolean } }
    | { type: "armTrack"; payload: { trackId: string; armed: boolean } }
    | { type: "freezeTrack"; payload: { trackId: string } }
    | { type: "unfreezeTrack"; payload: { trackId: string } }
    | { type: "bounceInPlace"; payload: { trackId: string } }
    | { type: "setTempo"; payload: { bpm: number } }
    | { type: "togglePlayback"; payload?: undefined }
    | { type: "stopPlayback"; payload?: undefined }
    | { type: "toggleRecording"; payload?: undefined }
    | { type: "setMasterGain"; payload: { gain: number } }
    | { type: "toggleLoop"; payload?: undefined }
    | { type: "toggleMetronome"; payload?: undefined }
    | { type: "addClip"; payload: { trackId: string; startBeat: number; endBeat: number; name: string } }
    | { type: "moveClip"; payload: { clipId: string; trackId: string; startBeat: number } }
    | { type: "duplicateClip"; payload: { clipId: string } }
    | { type: "removeClip"; payload: { clipId: string } }
    | { type: "splitClip"; payload: { clipId: string; beat: number } }
    | { type: "addDevice"; payload: { trackId: string; deviceType: string } }
    | { type: "bypassDevice"; payload: { deviceId: string; bypassed: boolean } }
    | { type: "removeDevice"; payload: { deviceId: string } }
    | { type: "createBus"; payload: { name: string } }
    | { type: "createFolder"; payload: { name: string } }
    | { type: "setSend"; payload: { trackId: string; busId: string; level: number } }
    | { type: "setWorkspaceMode"; payload: { mode: "arrange" | "clip" | "mix" } }
    | { type: "openMixer"; payload?: undefined }
    | { type: "closeMixer"; payload?: undefined }
    | { type: "addMarker"; payload: { beat: number; name: string } }
    | { type: "removeMarker"; payload: { markerId: string } }
    | { type: "quantizeNotes"; payload: { clipId: string; gridSize: number } }
    | { type: "transposeNotes"; payload: { clipId: string; semitones: number } }
    | { type: "humanizeNotes"; payload: { clipId: string; amount: number } };

export type TrackKind = "audio" | "midi" | "bus" | "master" | "folder";

export type AppActionType = AppAction["type"];

export const DESTRUCTIVE_ACTIONS: ReadonlySet<AppActionType> = new Set([
    "removeTrack",
    "removeClip",
    "removeDevice",
    "removeMarker",
    "bounceInPlace",
]);

export const REQUIRES_CONFIRMATION: ReadonlySet<AppActionType> = new Set([
    "removeTrack",
    "removeClip",
    "removeDevice",
    "bounceInPlace",
]);
