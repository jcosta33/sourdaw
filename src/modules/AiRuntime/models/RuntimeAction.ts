export type RuntimeTrackKind = 'audio' | 'midi' | 'bus' | 'master' | 'folder';

type RuntimeDocumentSnapshotEntry =
    { readonly state: 'present'; readonly bytes: Uint8Array } | { readonly state: 'absent' };
type RuntimeDocumentSnapshot = Map<string, RuntimeDocumentSnapshotEntry>;

export type RuntimeAction =
    | { type: 'addTrack'; payload: { id?: string; name: string; kind: RuntimeTrackKind; select?: boolean } }
    | { type: 'removeTrack'; payload: { trackId: string } }
    | {
          type: 'restoreTrack';
          payload: {
              trackId: string;
              trackSnapshot: { readonly id: string };
              trackName: string;
              trackKind: RuntimeTrackKind;
              trackGain: number;
              trackParentId: string | null;
              trackIndex: number;
              wasSelected: boolean;
              routingPatches: readonly {
                  readonly trackId: string;
                  readonly expected: {
                      readonly outputId: string;
                      readonly sends: readonly {
                          readonly busId: string;
                          readonly level: number;
                          readonly preFader: boolean;
                      }[];
                  };
                  readonly replacement: {
                      readonly outputId: string;
                      readonly sends: readonly {
                          readonly busId: string;
                          readonly level: number;
                          readonly preFader: boolean;
                      }[];
                  };
              }[];
              automationLaneSnapshots: readonly { readonly id: string; readonly trackId: string }[];
              midiNotesByClipId: Record<string, readonly { readonly id: string }[]>;
              midiCcByClipId: Record<string, readonly { readonly id: string }[]>;
              midiPitchBendByClipId: Record<string, readonly { readonly id: string }[]>;
              takeLaneSnapshots: readonly { readonly id: string; readonly trackId: string }[];
              sidechainRouteSnapshots: readonly {
                  readonly id: string;
                  readonly sourceTrackId: string;
                  readonly targetTrackId: string;
                  readonly targetDeviceId: string;
                  readonly targetParameterId: string;
                  readonly gain: number;
              }[];
              ownedModulatorSnapshots: readonly {
                  readonly id: string;
                  readonly name: string;
                  readonly trackId: string;
                  readonly enabled: boolean;
                  readonly mappings: readonly {
                      readonly targetTrackId: string;
                      readonly targetDeviceId: string;
                      readonly targetParamId: string;
                      readonly amount: number;
                  }[];
                  readonly kind: 'lfo' | 'envelope' | 'step';
                  readonly config:
                      | {
                            readonly kind: 'lfo';
                            readonly waveform: 'sine' | 'square' | 'saw' | 'triangle' | 'random';
                            readonly rate: number;
                            readonly sync: boolean;
                            readonly phase: number;
                            readonly depth: number;
                        }
                      | {
                            readonly kind: 'envelope';
                            readonly attack: number;
                            readonly decay: number;
                            readonly sustain: number;
                            readonly release: number;
                            readonly triggerMode: 'midi' | 'audio' | 'sync';
                        }
                      | {
                            readonly kind: 'step';
                            readonly steps: readonly number[];
                            readonly rate: number;
                            readonly smooth: number;
                        };
              }[];
              incomingModulationMappingSnapshots: readonly {
                  readonly modulatorId: string;
                  readonly mapping: {
                      readonly targetTrackId: string;
                      readonly targetDeviceId: string;
                      readonly targetParamId: string;
                      readonly amount: number;
                  };
              }[];
          };
      }
    | {
          type: 'restoreClip';
          payload: {
              clipId: string;
              trackId: string;
              clipSnapshot: {
                  readonly id: string;
                  readonly trackId: string;
                  readonly startBeat: number;
                  readonly endBeat: number;
              };
              ripplePlan: {
                  readonly removedClips: readonly {
                      readonly id: string;
                      readonly trackId: string;
                      readonly startBeat: number;
                      readonly endBeat: number;
                  }[];
                  readonly shiftedClips: readonly {
                      readonly clipId: string;
                      readonly origStartBeat: number;
                      readonly origEndBeat: number;
                  }[];
              } | null;
              midiNotesSnapshot: readonly { readonly id: string }[] | null;
              midiCcSnapshot: readonly { readonly id: string }[] | null;
              midiPitchBendSnapshot: readonly { readonly id: string }[] | null;
          };
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
    | { type: 'duplicateClip'; payload: { clipId: string } }
    | { type: 'duplicateClipToNextBar'; payload: { clipId: string } }
    | { type: 'duplicateTrack'; payload: { trackId: string; targetTrackId?: string; select?: boolean } }
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
    | {
          type: 'addAutomationLane';
          payload: { trackId: string; parameterId: string; parameterName: string };
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
          // Mirrors the AppAction payload: optional `seed`/`velocityAmount` let
          // the handler capture and replay the RNG seed for deterministic undo/redo.
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
    | { type: 'setAutomationMode'; payload: { trackId: string; mode: 'read' | 'write' | 'touch' | 'latch' | 'off' } }
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
          /** Inverse of the automation transform handlers. Restores a lane's points to a
           *  pre-execute snapshot. Mirrors Command's AppAction unions. */
          type: 'restoreAutomationLanePoints';
          payload: {
              laneId: string;
              points: readonly {
                  readonly beat: number;
                  readonly value: number;
                  readonly curve: string;
                  readonly tension: number;
                  readonly stairSteps?: number;
                  readonly cp1?: { readonly x: number; readonly y: number };
                  readonly cp2?: { readonly x: number; readonly y: number };
              }[];
          };
      }
    | { type: 'loadPreset'; payload: { presetId: string; trackId?: string } }
    | { type: 'savePreset'; payload: { trackId: string; name: string; category: string } }
    | { type: 'generateDrumPattern'; payload: { style: string; trackId?: string; bars?: number; density?: number } }
    | {
          type: 'generateMelody';
          payload: { style: string; key?: number; scale?: string; trackId?: string; bars?: number };
      }
    | {
          type: 'generateChordProgression';
          payload: { style: string; key?: number; scale?: string; trackId?: string; bars?: number; voicing?: string };
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
    | { type: 'createCollabSession'; payload: { name: string } }
    | { type: 'joinCollabSession'; payload: { inviteString: string; peerName: string } }
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
    | { type: 'detectTransients'; payload: { clipId: string; sensitivity?: number } }
    | { type: 'quantizeTransients'; payload: { clipId: string } }
    | { type: 'toggleNodeView'; payload?: undefined }
    | { type: 'setControlSurface'; payload: { protocol: 'mcu' | 'osc' | 'hui' | null } }
    | { type: 'addCvOutput'; payload: { name: string; channel: number; type: string } }
    | { type: 'connectPush'; payload: { model: 'push2' | 'push3' } }
    | { type: 'disconnectPush'; payload?: undefined }
    | { type: 'exportDawProject'; payload?: undefined }
    | { type: 'loadRaveModel'; payload: { modelId: string } }
    | { type: 'setRaveBlend'; payload: { blend: number } }
    | { type: 'enableWarping'; payload: { clipId: string } }
    | { type: 'setWarpAlgorithm'; payload: { clipId: string; algorithm: string } }
    | { type: 'setWarpPitchShift'; payload: { clipId: string; semitones: number } }
    | { type: 'restoreDsoSnapshot'; payload: { bundle: RuntimeDocumentSnapshot } };

export type RuntimeActionType = RuntimeAction['type'];
