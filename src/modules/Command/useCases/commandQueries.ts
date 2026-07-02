import { type DocumentBundle } from '#/modules/CrdtDocument/useCases';

/**
 * Structural snapshot shapes carried by inverse actions (`restoreTrack` / `restoreClip`).
 * See `Command/models/AppAction.ts` for full rationale — these are structural types the
 * Command layer knows without importing Arrangement's concrete models.
 */
export type TrackSnapshot = { readonly id: string };
export type ClipSnapshot = {
    readonly id: string;
    readonly trackId: string;
    readonly startBeat: number;
    readonly endBeat: number;
};
export type AutomationLaneSnapshot = { readonly id: string; readonly trackId: string };
/** A captured automation point, carried by the `restoreAutomationLanePoints` inverse
 *  action. Command cannot import Automation's `AutomationPoint` model (model isolation),
 *  so this specifies only the fields a transform-undo round-trips. */
export type AutomationPointSnapshot = {
    readonly beat: number;
    readonly value: number;
    readonly curve: string;
    readonly tension: number;
    readonly stairSteps?: number;
    readonly cp1?: { readonly x: number; readonly y: number };
    readonly cp2?: { readonly x: number; readonly y: number };
};
export type TakeLaneSnapshot = { readonly id: string; readonly trackId: string };
export type MidiNotesSnapshot = readonly { readonly id: string }[];
export type MidiCcSnapshot = readonly { readonly id: string }[];
export type MidiPitchBendSnapshot = readonly { readonly id: string }[];
export type RippleShiftSnapshot = {
    readonly clipId: string;
    readonly origStartBeat: number;
    readonly origEndBeat: number;
};
export type RipplePlanSnapshot = {
    readonly removedClips: readonly ClipSnapshot[];
    readonly shiftedClips: readonly RippleShiftSnapshot[];
};

export type AutomationMode = 'read' | 'write' | 'touch' | 'latch' | 'off';

export type AppAction =
    | { type: 'addTrack'; payload: { id?: string; name: string; kind: TrackKind } }
    | { type: 'removeTrack'; payload: { trackId: string } }
    | {
          /** Inverse of `removeTrack`. Carries full snapshots of the removed track and its
           *  satellite state (automation, MIDI, take lanes). Emitted only by the
           *  `removeTrack` handler's `describe()` — not invoked directly. */
          type: 'restoreTrack';
          payload: {
              trackId: string;
              trackSnapshot: TrackSnapshot;
              automationLaneSnapshots: readonly AutomationLaneSnapshot[];
              midiNotesByClipId: Record<string, MidiNotesSnapshot>;
              midiCcByClipId: Record<string, MidiCcSnapshot>;
              midiPitchBendByClipId: Record<string, MidiPitchBendSnapshot>;
              takeLaneSnapshots: readonly TakeLaneSnapshot[];
          };
      }
    | {
          /** Inverse of `removeClip`. Carries the removed clip and any ripple-shift plan
           *  needed to restore neighbour positions. Emitted only by the `removeClip`
           *  handler's `describe()` — not invoked directly. */
          type: 'restoreClip';
          payload: {
              clipId: string;
              trackId: string;
              clipSnapshot: ClipSnapshot;
              ripplePlan: RipplePlanSnapshot | null;
              midiNotesSnapshot: MidiNotesSnapshot | null;
              midiCcSnapshot: MidiCcSnapshot | null;
              midiPitchBendSnapshot: MidiPitchBendSnapshot | null;
          };
      }
    | {
          /** Inverse of clip duplication. Removes the exact duplicate created by
           *  `duplicateClip` / `duplicateClipToNextBar` without applying the user's
           *  current ripple-delete mode. */
          type: 'discardDuplicatedClip';
          payload: { clipId: string };
      }
    | { type: 'removeAllTracks'; payload?: undefined }
    | { type: 'renameTrack'; payload: { trackId: string; name: string } }
    | { type: 'createTrackAlternative'; payload: { trackId: string; name: string; duplicateActive: boolean } }
    | { type: 'switchTrackAlternative'; payload: { trackId: string; alternativeId: string } }
    | { type: 'renameTrackAlternative'; payload: { trackId: string; alternativeId: string; name: string } }
    | { type: 'deleteTrackAlternative'; payload: { trackId: string; alternativeId: string } }
    | { type: 'selectTrack'; payload: { trackId: string } }
    | { type: 'muteTrack'; payload: { trackId: string; muted: boolean } }
    | { type: 'soloTrack'; payload: { trackId: string; soloed: boolean } }
    | { type: 'toggleSoloSafe'; payload: { trackId: string } }
    | { type: 'armTrack'; payload: { trackId: string; armed: boolean } }
    | { type: 'freezeTrack'; payload: { trackId: string } }
    | { type: 'unfreezeTrack'; payload: { trackId: string } }
    | { type: 'flattenTrack'; payload: { trackId: string } }
    | { type: 'bounceInPlace'; payload: { trackId: string } }
    | { type: 'reorderTrack'; payload: { trackId: string; newIndex: number } }
    | { type: 'setTempo'; payload: { bpm: number } }
    | { type: 'setTimeSignature'; payload: { numerator: number; denominator: number } }
    | { type: 'togglePlayback'; payload?: undefined }
    | { type: 'stopPlayback'; payload?: undefined }
    | { type: 'toggleRecording'; payload?: undefined }
    | { type: 'setMasterGain'; payload: { gain: number } }
    | { type: 'toggleLoop'; payload?: undefined }
    | { type: 'toggleMetronome'; payload?: undefined }
    | { type: 'setMetronomeVolume'; payload: { volume: number } }
    | { type: 'setLoopRegion'; payload: { startBeat: number; endBeat: number } }
    | {
          type: 'addClip';
          payload: {
              trackId: string;
              startBeat: number;
              endBeat: number;
              name: string;
              type?: 'audio' | 'midi';
              audioBufferId?: string;
          };
      }
    | { type: 'moveClip'; payload: { clipId: string; trackId: string; startBeat: number } }
    | { type: 'duplicateClip'; payload: { clipId: string; targetClipId?: string } }
    | { type: 'duplicateClipToNextBar'; payload: { clipId: string; targetClipId?: string } }
    | { type: 'duplicateTrack'; payload: { trackId: string } }
    | { type: 'removeClip'; payload: { clipId: string } }
    | { type: 'renameClip'; payload: { clipId: string; name: string } }
    | { type: 'splitClip'; payload: { clipId: string; beat: number } }
    | { type: 'trimClipStart'; payload: { clipId: string; newStartBeat: number } }
    | { type: 'trimClipEnd'; payload: { clipId: string; newEndBeat: number } }
    | { type: 'addDevice'; payload: { trackId: string; deviceType: string } }
    | { type: 'bypassDevice'; payload: { deviceId: string; bypassed: boolean } }
    | { type: 'removeDevice'; payload: { deviceId: string } }
    | { type: 'setDeviceParameter'; payload: { deviceId: string; paramId: string; value: number } }
    | { type: 'createBus'; payload: { name: string } }
    | { type: 'createFolder'; payload: { name: string } }
    | { type: 'setSend'; payload: { trackId: string; busId: string; level: number } }
    | { type: 'setWorkspaceMode'; payload: { mode: 'arrange' | 'clip' } }
    | { type: 'openPreferencesDialog'; payload?: undefined }
    | { type: 'openMixer'; payload?: undefined }
    | { type: 'closeMixer'; payload?: undefined }
    | { type: 'toggleSidebar'; payload?: undefined }
    | { type: 'toggleInspector'; payload?: undefined }
    | { type: 'toggleChatPanel'; payload?: undefined }
    | { type: 'setTrackInput'; payload: { trackId: string; inputId: string | null } }
    | { type: 'setEditingTool'; payload: { tool: string } }
    | {
          type: 'setMarqueeSelection';
          payload: { selection: { startBeat: number; endBeat: number; trackIds: string[] } | null };
      }
    | { type: 'addMarker'; payload: { beat: number; name: string } }
    | { type: 'removeMarker'; payload: { markerId: string } }
    | { type: 'setMarkerColor'; payload: { markerId: string; color: string } }
    | { type: 'addSection'; payload: { startBeat: number; endBeat: number; name: string } }
    | { type: 'removeSection'; payload: { sectionId: string } }
    | { type: 'renameSection'; payload: { sectionId: string; name: string } }
    | { type: 'addAutomationLane'; payload: { trackId: string; parameterId: string; parameterName: string } }
    | {
          /** Inverse of `addAutomationLane`. Keyed by `(trackId, parameterId)` — the
           *  identity a lane is created under — because the generated lane id is not
           *  known when the inverse is captured (pre-execute). Emitted only by the
           *  `addAutomationLane` handler's `describe()`. Keep mirrored in
           *  Command/models/AppAction.ts and AiRuntime/models/RuntimeAction.ts. */
          type: 'removeAutomationLane';
          payload: { trackId: string; parameterId: string };
      }
    | {
          type: 'addAutomationPoint';
          payload: {
              laneId: string;
              beat: number;
              value: number;
              curve?: 'linear' | 'step' | 'exponential' | 's-curve' | 'stairs' | 'smooth' | 'bezier';
              tension?: number;
              stairSteps?: number;
              cp1?: { x: number; y: number };
              cp2?: { x: number; y: number };
          };
      }
    | { type: 'quantizeNotes'; payload: { clipId: string; gridSize: number; strength?: number; swing?: number } }
    | { type: 'quantizeNoteLengths'; payload: { clipId: string; gridSize: number } }
    | { type: 'transposeNotes'; payload: { clipId: string; semitones: number } }
    | {
          type: 'humanizeNotes';
          // `seed`/`velocityAmount` are optional and captured by the handler on
          // first execute, replayed on redo — kept in sync with
          // Command/models/AppAction.ts and AiRuntime/models/RuntimeAction.ts.
          payload: { clipId: string; amount: number; velocityAmount?: number; seed?: number };
      }
    | { type: 'invertNotes'; payload: { clipId: string } }
    | { type: 'retrogradeNotes'; payload: { clipId: string } }
    | {
          type: 'scaleVelocities';
          payload: { clipId: string; curve: string; minVelocity?: number; maxVelocity?: number };
      }
    | { type: 'scaleAllVelocities'; payload: { clipId: string; factor: number } }
    | { type: 'setAllVelocities'; payload: { clipId: string; velocity: number } }
    | { type: 'setTrackGain'; payload: { trackId: string; gain: number } }
    | { type: 'setTrackPan'; payload: { trackId: string; pan: number } }
    | { type: 'setTrackColor'; payload: { trackId: string; color: string } }
    | { type: 'copyClip'; payload?: undefined }
    | { type: 'cutClip'; payload?: undefined }
    | { type: 'pasteClip'; payload?: undefined }
    | { type: 'setClipFade'; payload: { clipId: string; fadeInBeats: number; fadeOutBeats: number } }
    | { type: 'importMidiFile'; payload?: undefined }
    | { type: 'normalizeClip'; payload: { clipId: string; mode?: 'peak' | 'rms' | 'lufs'; targetDb?: number } }
    | { type: 'reverseClip'; payload: { clipId: string } }
    | { type: 'glueClips'; payload: { clipIds: string[] } }
    | { type: 'nudgeClip'; payload: { clipId: string; beats: number } }
    | { type: 'crossfadeClips'; payload: { clipAId: string; clipBId: string; durationBeats: number } }
    | { type: 'setClipGain'; payload: { clipId: string; gain: number } }
    | { type: 'setClipColor'; payload: { clipId: string; color: string } }
    | { type: 'lockClip'; payload: { clipId: string; locked: boolean } }
    | { type: 'consolidateSelection'; payload: { trackId: string; startBeat: number; endBeat: number } }
    | { type: 'bounceSelection'; payload: { trackId: string; startBeat: number; endBeat: number } }
    | { type: 'seekPlayhead'; payload: { beat: number } }
    | { type: 'setPunchIn'; payload: { beat: number } }
    | { type: 'setPunchOut'; payload: { beat: number } }
    | { type: 'togglePunch'; payload?: undefined }
    | { type: 'toggleCountIn'; payload?: undefined }
    | { type: 'setCountInBars'; payload: { bars: number } }
    | { type: 'togglePreRoll'; payload?: undefined }
    | { type: 'setPreRollBars'; payload: { bars: number } }
    | { type: 'zoomTracksVertical'; payload: { delta: number } }
    | { type: 'addTimeSignatureChange'; payload: { beat: number; numerator: number; denominator: number } }
    | { type: 'removeTimeSignatureChange'; payload: { beat: number } }
    | { type: 'setTrackOutput'; payload: { trackId: string; outputId: string } }
    | { type: 'addSend'; payload: { trackId: string; busId: string; level: number } }
    | { type: 'removeSend'; payload: { trackId: string; busId: string } }
    | { type: 'removeAutomationPoint'; payload: { laneId: string; pointIndex: number } }
    | { type: 'setAutomationMode'; payload: { trackId: string; mode: AutomationMode } }
    | { type: 'hideTrack'; payload: { trackId: string; hidden: boolean } }
    | { type: 'disableTrack'; payload: { trackId: string; disabled: boolean } }
    | { type: 'setTrackHeight'; payload: { trackId: string; height: number } }
    | { type: 'setSnapValue'; payload: { value: number } }
    | { type: 'zoomToFit'; payload?: undefined }
    | { type: 'zoomToSelection'; payload?: undefined }
    | { type: 'exportProject'; payload?: undefined }
    | { type: 'saveProject'; payload?: undefined }
    | { type: 'newProject'; payload?: undefined }
    | { type: 'importAudioFile'; payload?: undefined }
    | { type: 'exportMidi'; payload: { clipId: string } }
    | { type: 'foldTrack'; payload: { trackId: string; folded: boolean } }
    | { type: 'groupTracks'; payload: { trackIds: string[]; name: string } }
    | { type: 'ungroupTracks'; payload: { groupId: string } }
    | { type: 'scaleAutomation'; payload: { laneId: string; factor: number; anchor?: number } }
    | { type: 'stretchAutomation'; payload: { laneId: string; factor: number; anchorBeat?: number } }
    | { type: 'invertAutomation'; payload: { laneId: string } }
    | { type: 'reverseAutomation'; payload: { laneId: string } }
    | { type: 'thinAutomation'; payload: { laneId: string; tolerance?: number } }
    | { type: 'quantizeAutomation'; payload: { laneId: string; gridSize: number } }
    | {
          /** Inverse of the automation transform handlers (reverse/scale/stretch/thin/
           *  quantize/invert). Restores a lane's `points` to a snapshot captured
           *  pre-execute. Emitted only by those handlers' `describe()` — not invoked
           *  directly. Keep mirrored in Command/models/AppAction.ts and
           *  AiRuntime/models/RuntimeAction.ts. */
          type: 'restoreAutomationLanePoints';
          payload: { laneId: string; points: readonly AutomationPointSnapshot[] };
      }
    | { type: 'loadPreset'; payload: { presetId: string; trackId?: string } }
    | { type: 'savePreset'; payload: { trackId: string; name: string; category: string } }
    | {
          type: 'generateDrumPattern';
          payload: { style: string; trackId?: string; bars?: number; density?: number; startBeat?: number };
      }
    | {
          type: 'generateMelody';
          payload: {
              style: string;
              key?: number;
              scale?: string;
              trackId?: string;
              bars?: number;
              octave?: number;
              density?: number;
              startBeat?: number;
          };
      }
    | {
          type: 'generateChordProgression';
          payload: {
              style: string;
              key?: number;
              scale?: string;
              trackId?: string;
              bars?: number;
              voicing?: string;
              startBeat?: number;
          };
      }
    | { type: 'setClipLoop'; payload: { clipId: string; enabled: boolean } }
    | { type: 'setClipLoopLength'; payload: { clipId: string; loopLength: number } }
    | { type: 'extractGroove'; payload: { clipId: string } }
    | { type: 'applyGroove'; payload: { clipId: string; grooveId: string; amount?: number } }
    | { type: 'setClipStretchMode'; payload: { clipId: string; mode: 'off' | 'repitch' | 'timestretch' } }
    | { type: 'setClipStretchRatio'; payload: { clipId: string; ratio: number } }
    | { type: 'fitClipToBeats'; payload: { clipId: string; targetBeats: number } }
    | { type: 'analyzeMix'; payload?: undefined }
    | { type: 'autoFixMix'; payload?: undefined }
    | { type: 'enableMpe'; payload?: undefined }
    | { type: 'disableMpe'; payload?: undefined }
    | { type: 'getLatencyReport'; payload?: undefined }
    | { type: 'createCollabSession'; payload: { name?: string } }
    | { type: 'joinCollabSession'; payload: { inviteString: string; peerName?: string } }
    | { type: 'leaveCollabSession'; payload?: undefined }
    | { type: 'scanPlugins'; payload?: undefined }
    | { type: 'loadExternalPlugin'; payload: { pluginId: string; trackId?: string } }
    | { type: 'audioToMidi'; payload: { clipId: string; trackId?: string; sensitivity?: number; mode?: string } }
    | { type: 'muteClip'; payload: { clipId: string; muted: boolean } }
    | { type: 'clearSolos'; payload?: undefined }
    | { type: 'setTrackNotes'; payload: { trackId: string; notes: string } }
    | { type: 'deleteTime'; payload: { startBeat: number; endBeat: number } }
    | { type: 'insertTime'; payload: { atBeat: number; durationBeats: number } }
    | { type: 'duplicateTimeRange'; payload: { startBeat: number; endBeat: number } }
    | { type: 'stripSilence'; payload: { clipId: string; threshold?: number; minDuration?: number } }
    | { type: 'detectTempo'; payload: { clipId: string } }
    | { type: 'detectKey'; payload: { clipId: string } }
    | { type: 'consolidateAllTracks'; payload?: undefined }
    | {
          type: 'arpeggiate';
          payload: { clipId: string; pattern?: string; rate?: number; octaves?: number; gate?: number };
      }
    | { type: 'addSidechainRoute'; payload: { sourceTrackId: string; targetTrackId: string } }
    | { type: 'removeSidechainRoute'; payload: { sourceTrackId: string; targetTrackId: string } }
    | { type: 'bounceToNewTrack'; payload: { trackId: string } }
    | { type: 'saveTrackTemplate'; payload: { trackId: string; name: string; category: string } }
    | { type: 'loadTrackTemplate'; payload: { templateId: string } }
    | { type: 'deleteTrackTemplate'; payload: { templateId: string } }
    | { type: 'createVcaGroup'; payload: { name: string; trackIds: string[] } }
    | { type: 'assignToVca'; payload: { trackId: string; vcaGroupId: string } }
    | { type: 'removeFromVca'; payload: { trackId: string } }
    | { type: 'setVcaGain'; payload: { vcaGroupId: string; gain: number } }
    | { type: 'setMidiOutput'; payload: { trackId: string; destinationTrackId: string } }
    | { type: 'clearMidiOutput'; payload: { trackId: string } }
    | {
          type: 'addNotes';
          payload: {
              clipId: string;
              notes: Array<{ pitch: number; startBeat: number; duration: number; velocity?: number }>;
          };
      }
    | {
          type: 'completeMidi';
          payload: { clipId: string; direction?: 'forward' | 'backward'; bars?: number };
      }
    | { type: 'variationMidi'; payload: { clipId: string; amount?: number } }
    | { type: 'generateBassline'; payload: { clipId: string; style?: string; trackId?: string } }
    | {
          type: 'generateAudio';
          payload: { prompt: string; durationSeconds?: number; trackId?: string };
      }
    | {
          type: 'stemSeparate';
          payload: { clipId: string; stems?: string[] };
      }
    | {
          type: 'autoOrganizeProject';
          payload: {
              tracks: Array<{
                  trackId: string;
                  newName?: string;
                  color?: string;
                  folderName?: string;
              }>;
          };
      }
    | { type: 'addChordEvent'; payload: { beat: number; root: number; quality: string; duration?: number } }
    | { type: 'removeChordEvent'; payload: { eventId: string } }
    | { type: 'toggleChordTrack'; payload?: { enabled?: boolean } }
    | { type: 'clearChordTrack'; payload?: undefined }
    | { type: 'clearAllMidiMappings'; payload?: undefined }
    | { type: 'toggleScratchPad'; payload?: undefined }
    | { type: 'captureScratchPad'; payload?: undefined }
    | { type: 'commitScratchPad'; payload?: undefined }
    | { type: 'clearScratchPad'; payload?: undefined }
    | { type: 'createPatternInstance'; payload: { sourceClipId: string; targetTrackId: string; startBeat: number } }
    | { type: 'detachPatternInstance'; payload: { clipId: string } }
    | { type: 'startMacroRecording'; payload?: undefined }
    | { type: 'stopMacroRecording'; payload: { name: string } }
    | { type: 'playMacro'; payload: { macroId: string } }
    | { type: 'deleteMacro'; payload: { macroId: string } }
    | { type: 'renameMacro'; payload: { macroId: string; name: string } }
    | { type: 'undo'; payload?: undefined }
    | { type: 'redo'; payload?: undefined }
    | { type: 'toggleUndoTree'; payload?: undefined }
    | { type: 'labelUndoBranch'; payload: { nodeId: string; label: string } }
    | { type: 'detectSongStructure'; payload: { trackId?: string } }
    | { type: 'createProjectVersion'; payload: { label: string; description?: string } }
    | { type: 'restoreProjectVersion'; payload: { versionId: string } }
    | { type: 'createVersionBranch'; payload: { name: string } }
    | { type: 'generateFill'; payload: { atBeat: number; durationBeats?: number; style?: string } }
    | { type: 'generateAllTransitions'; payload?: undefined }
    | { type: 'compareToReference'; payload?: undefined }
    | { type: 'toggleControlRoomMono'; payload?: undefined }
    | { type: 'toggleControlRoomDim'; payload?: undefined }
    | { type: 'switchMonitor'; payload: { monitorId: string } }
    | { type: 'getMentorTips'; payload?: undefined }
    | { type: 'searchSamples'; payload: { query: string } }
    | { type: 'createCompGroup'; payload: { name: string; trackIds: string[] } }
    | { type: 'togglePunchRecording'; payload?: undefined }
    | { type: 'toggleLoopRecord'; payload: { slotId: string } }
    | { type: 'triggerScene'; payload: { column: number } }
    | { type: 'nextSetlistItem'; payload?: undefined }
    | { type: 'previousSetlistItem'; payload?: undefined }
    | { type: 'createAdjustmentLayer'; payload: { name: string; effectType: string } }
    | { type: 'removeAdjustmentLayer'; payload: { layerId: string } }
    | { type: 'toggleAdjustmentLayer'; payload: { layerId: string } }
    | { type: 'setLayerParameter'; payload: { layerId: string; paramName: string; value: number } }
    | { type: 'setLayerMix'; payload: { layerId: string; mix: number } }
    | { type: 'addAdjustmentRegion'; payload: { layerId: string; startBeat: number; endBeat: number; blend?: number } }
    | { type: 'removeAdjustmentRegion'; payload: { layerId: string; regionId: string } }
    | { type: 'moveAdjustmentRegion'; payload: { regionId: string; startBeat: number; endBeat: number } }
    | { type: 'setLayerFades'; payload: { regionId: string; fadeInBeats: number; fadeOutBeats: number } }
    | { type: 'setLayerAffectedTracks'; payload: { layerId: string; trackIds: string[] } }
    | { type: 'setLayerInsertionIndex'; payload: { layerId: string; insertionIndex: number } }
    | { type: 'detectTransients'; payload: { clipId: string; sensitivity?: number } }
    | { type: 'quantizeTransients'; payload: { clipId: string } }
    | { type: 'openElasticEditor'; payload: { clipId: string } }
    | { type: 'closeElasticEditor'; payload?: undefined }
    | { type: 'elasticSetSensitivity'; payload: { sensitivity: number } }
    | { type: 'elasticAddMarker'; payload: { clipId: string; localBeat: number } }
    | { type: 'elasticRemoveMarker'; payload: { markerId: string } }
    | { type: 'elasticToggleMarkerLock'; payload: { markerId: string } }
    | {
          type: 'elasticSetTool';
          payload: { tool: 'select' | 'add-marker' | 'remove-marker' | 'lock-marker' };
      }
    | { type: 'toggleNodeView'; payload?: undefined }
    | { type: 'setControlSurface'; payload: { protocol: 'mcu' | 'osc' | 'hui' | null } }
    | { type: 'addCvOutput'; payload: { name: string; channel: number; type: string } }
    | { type: 'connectPush'; payload: { model: 'push2' | 'push3' } }
    | { type: 'disconnectPush'; payload?: undefined }
    | { type: 'exportDawProject'; payload?: undefined }
    | { type: 'importDawProject'; payload?: undefined }
    | { type: 'loadRaveModel'; payload: { modelId: string } }
    | { type: 'setRaveBlend'; payload: { blend: number } }
    | { type: 'enableWarping'; payload: { clipId: string } }
    | { type: 'setWarpAlgorithm'; payload: { clipId: string; algorithm: string } }
    | { type: 'setWarpPitchShift'; payload: { clipId: string; semitones: number } }
    | { type: 'restoreDsoSnapshot'; payload: { bundle: DocumentBundle } };

export type TrackKind = 'audio' | 'midi' | 'bus' | 'master' | 'folder';

export type AppActionType = AppAction['type'];

/** Return shape of `ActionHandler.describe` — exported for `#/utils/createHandler`. */
export type HandlerDescribeResult = {
    label: string;
    inverseAction?: AppAction | null;
};

export type ActionHandler<Action extends AppAction = AppAction> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => HandlerDescribeResult;
    undoable: boolean;
};

export type UndoSource = 'manual' | 'prompt' | 'voice' | 'ai';

type UndoEntryBase = {
    id: string;
    label: string;
    timestamp: number;
    source: UndoSource;
    groupId?: string;
    groupLabel?: string;
};

export type ActionUndoEntry = UndoEntryBase & {
    kind: 'action';
    action: AppAction;
    inverseAction: AppAction | null;
};

export type CallbackUndoEntry = UndoEntryBase & {
    kind: 'callback';
    undo: () => void;
    redo: () => void;
};

export type UndoEntry = ActionUndoEntry | CallbackUndoEntry;

export function createUndoEntry(
    label: string,
    action: AppAction,
    inverseAction: AppAction | null,
    source: UndoSource = 'manual'
): ActionUndoEntry {
    return {
        id: `undo-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'action',
        label,
        action,
        inverseAction,
        timestamp: Date.now(),
        source,
    };
}

export function createCallbackUndoEntry(
    label: string,
    undoFn: () => void,
    redoFn: () => void,
    source: UndoSource = 'manual'
): CallbackUndoEntry {
    return {
        id: `undo-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'callback',
        label,
        undo: undoFn,
        redo: redoFn,
        timestamp: Date.now(),
        source,
    };
}

export function generateGroupId(label: string): { groupId: string; groupLabel: string } {
    return {
        groupId: `group-${crypto.randomUUID().slice(0, 8)}`,
        groupLabel: label,
    };
}

export function isActionEntry(entry: UndoEntry): entry is ActionUndoEntry {
    return entry.kind === 'action';
}
