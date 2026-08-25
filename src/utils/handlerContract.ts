/**
 * Neutral cross-module handler contract. Houses the pure `AppAction` discriminated
 * union plus the `ActionHandler` / `HandlerDescribeResult` / `ExecuteOptions` types that
 * `createHandler` and every `get<Module>Handlers` factory build against. Lives in
 * `src/utils/` (not a domain module) so handler code across modules depends on this
 * neutral surface rather than on a type-only entry point in `Command/useCases`.
 * Snapshot payloads stay structural so this contract does not depend on concrete models
 * owned by other modules.
 */

/**
 * Structural mirror of the `DeviceStateChunk` model. Kept structural, like every
 * other snapshot here, so this neutral contract does not depend on a model owned by
 * the Arrangement module.
 */
export type DeviceStateValueSnapshot =
    string | number | boolean | null | DeviceStateValueSnapshot[] | { [key: string]: DeviceStateValueSnapshot };

export type DeviceStateChunkSnapshot = {
    readonly version: number;
    readonly data: { readonly [key: string]: DeviceStateValueSnapshot };
};

export type DeviceSnapshot = {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly bypassed: boolean;
    readonly parameterValues: Readonly<Record<string, number>>;
    readonly externalPluginId?: string;
    readonly externalInstanceId?: string;
    readonly externalStateChunk?: string;
    readonly deviceState?: DeviceStateChunkSnapshot;
};
export type DeviceChainTopologySnapshot = {
    readonly id: string;
    readonly kind: 'audio' | 'midi' | 'bus' | 'master' | 'folder';
    readonly devices: readonly {
        readonly id: string;
        readonly type: string;
        readonly externalInstanceId?: string;
        readonly parameterIds: readonly string[];
    }[];
};
export type BatchRestoreDeviceSnapshot = {
    readonly trackId: string;
    readonly deviceId: string;
    readonly deviceIndex: number;
};
export type TrackSnapshot = { readonly id: string };
export type BatchRestoreTrackSnapshot = {
    readonly trackId: string;
    readonly trackIndex: number;
};
export type TrackSendSnapshot = {
    readonly busId: string;
    readonly level: number;
    readonly preFader: boolean;
};
export type TrackRoutingStateSnapshot = {
    readonly outputId: string;
    readonly sends: readonly TrackSendSnapshot[];
};
export type TrackRoutingPatchSnapshot = {
    readonly trackId: string;
    readonly expected: TrackRoutingStateSnapshot;
    readonly replacement: TrackRoutingStateSnapshot;
};
export type SidechainRouteSnapshot = {
    readonly id: string;
    readonly sourceTrackId: string;
    readonly targetTrackId: string;
    readonly targetDeviceId: string;
    readonly targetParameterId: string;
    readonly gain: number;
};
export type ModulatorMappingSnapshot = {
    readonly targetTrackId: string;
    readonly targetDeviceId: string;
    readonly targetParamId: string;
    readonly amount: number;
};
export type ModulatorSnapshot = {
    readonly id: string;
    readonly name: string;
    readonly trackId: string;
    readonly enabled: boolean;
    readonly mappings: readonly ModulatorMappingSnapshot[];
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
};
export type IncomingModulationMappingSnapshot = {
    readonly modulatorId: string;
    readonly mapping: ModulatorMappingSnapshot;
};
export type ClipSnapshot = {
    readonly id: string;
    readonly trackId: string;
    readonly startBeat: number;
    readonly endBeat: number;
};
export type ClipStateSnapshot = {
    readonly id: string;
    readonly trackId: string;
    readonly name: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly type: 'audio' | 'midi';
    readonly audioBufferId?: string;
    readonly fileId?: string;
    readonly assetHash?: string;
    readonly audioOffsetBeats?: number;
    readonly midiOffsetBeats?: number;
    readonly fadeInBeats: number;
    readonly fadeOutBeats: number;
    readonly gain: number;
    readonly color: string;
    readonly locked: boolean;
    readonly muted: boolean;
    readonly stretchMode?: 'off' | 'repitch' | 'timestretch';
    readonly stretchRatio?: number;
    readonly loopEnabled?: boolean;
    readonly loopLength?: number;
    readonly followAction?: 'stop' | 'play_next' | 'play_previous' | 'play_random' | 'play_first' | 'play_last';
    readonly generating?: boolean;
    readonly isGhost?: boolean;
    readonly isInlineEditing?: boolean;
    readonly parentClipId?: string;
    readonly isLinkedInstance?: boolean;
    readonly sourceKeyRoot?: number;
    readonly sourceScaleName?: string;
    readonly overrides?: Readonly<Record<string, boolean>>;
    readonly kneadState?: {
        readonly blobs: readonly {
            readonly id: string;
            readonly startTime: number;
            readonly endTime: number;
            readonly pitchCenterCents: number;
            readonly originalPitchCenterCents?: number;
            readonly pitchCurveCents: readonly number[];
            readonly voicedConfidence: number;
        }[];
        readonly retuneSpeedMs: number;
        readonly humanizePercent: number;
        readonly formantPreserve: boolean;
    };
};
export type ClipAutomationLaneActionSnapshot = {
    readonly id: string;
    readonly trackId: string;
    readonly points: readonly AutomationPointSnapshot[];
};
export type ClipMoveActionSnapshot = {
    readonly trackId: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly automationLanes: readonly ClipAutomationLaneActionSnapshot[];
};
export type ClipStretchStateSnapshot = {
    readonly startBeat: number;
    readonly endBeat: number;
    readonly mode: { readonly present: boolean; readonly value: 'off' | 'repitch' | 'timestretch' };
    readonly ratio: { readonly present: boolean; readonly value: number };
};
export type AutomationLaneSnapshot = { readonly id: string; readonly trackId: string };
export type ClipSatelliteWarpMarkerSnapshot = {
    readonly id: string;
    readonly originalBeat: number;
    readonly warpedBeat: number;
    readonly origin?: 'user' | 'transient-auto' | 'grid-snap';
    readonly confidence?: number;
    readonly locked?: boolean;
};
export type ClipSatelliteWarpStateSnapshot = {
    readonly enabled: boolean;
    readonly markers: readonly ClipSatelliteWarpMarkerSnapshot[];
    readonly stretchMode: 'repitch' | 'complex' | 'texture' | 'beats';
    readonly originalTempo: number | null;
};
export type ClipSatelliteGainEnvelopePointSnapshot = {
    readonly id: string;
    readonly beatOffset: number;
    readonly gainDb: number;
};
export type ClipSatelliteGainEnvelopeSnapshot = {
    readonly clipId: string;
    readonly points: readonly ClipSatelliteGainEnvelopePointSnapshot[];
    readonly enabled: boolean;
};
/** A clip's gain envelope and warp state — the per-clip satellites owned by
 *  Arrangement's `clipSatelliteState` store pair. Kept structural (not imported
 *  from Arrangement's models) for the same reason every other snapshot here is. */
export type ClipSatelliteEntrySnapshot = {
    readonly clipId: string;
    readonly gainEnvelope: ClipSatelliteGainEnvelopeSnapshot | null;
    readonly warpState: ClipSatelliteWarpStateSnapshot | null;
};
/** A captured automation point, carried by the `restoreAutomationLanePoints` inverse
 *  action. Command cannot import Automation's `AutomationPoint` model (model isolation),
 *  so this specifies only the fields a transform-undo round-trips. */
export type AutomationPointSnapshot = {
    readonly id?: string;
    readonly beat: number;
    readonly value: number;
    readonly curve: string;
    readonly tension: number;
    readonly stairSteps?: number;
    readonly cp1?: { readonly x: number; readonly y: number };
    readonly cp2?: { readonly x: number; readonly y: number };
};
/** A bounded automation container owned by one lane, carried verbatim inside
 *  `ClipAutomationLaneSnapshot`. */
export type ClipAutomationObjectSnapshot = {
    readonly id: string;
    readonly laneId: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly points: readonly AutomationPointSnapshot[];
    readonly poolId?: string;
    readonly loopLength?: number;
    readonly overrides?: Readonly<Record<string, boolean>>;
    readonly name: string;
};
/** A WHOLE clip-scoped automation lane, carried by the clip-identity actions
 *  (`stripSilence`, `glueClips`, `restoreClip`) whose inverses must be able to
 *  put a retired lane back exactly as it was. Unlike `AutomationLaneSnapshot`
 *  — an id-only reference used where the lane still lives in its own store —
 *  every field of Automation's `AutomationLane` is declared here, because the
 *  generated argument schema closes each object (`additionalProperties: false`)
 *  and an undeclared field makes the whole envelope unallowlisted. Kept
 *  structural (not imported from Automation's models) for the same reason
 *  every other snapshot here is. */
export type ClipAutomationLaneSnapshot = {
    readonly id: string;
    readonly trackId: string;
    readonly clipId?: string;
    readonly clipAutomationMode?: 'additive' | 'multiplicative';
    readonly parameterId: string;
    readonly parameterName: string;
    readonly points: readonly AutomationPointSnapshot[];
    readonly trimPoints?: readonly AutomationPointSnapshot[];
    readonly objects: readonly ClipAutomationObjectSnapshot[];
    readonly ghostPoints?: readonly AutomationPointSnapshot[];
    readonly visible: boolean;
    readonly enabled: boolean;
    readonly collapsed: boolean;
    readonly linkedLaneId?: string;
    readonly linkScale?: number;
    readonly minValue: number;
    readonly maxValue: number;
    readonly viewMinValue?: number;
    readonly viewMaxValue?: number;
    readonly color?: string;
};
export type TakeLaneSnapshot = { readonly id: string; readonly trackId: string };
export type MidiNotesSnapshot = readonly { readonly id: string }[];
export type MidiClipNoteSnapshot = {
    readonly id: string;
    readonly pitch: number;
    readonly startBeat: number;
    readonly duration: number;
    readonly velocity: number;
    readonly probability?: number;
    readonly pressure?: number;
    readonly slide?: number;
    readonly pitchBend?: number;
    readonly pitchBendRangeSemitones?: number;
    readonly channel?: number;
    readonly articulation?: string;
};
export type MidiCcSnapshot = readonly { readonly id: string }[];
export type MidiPitchBendSnapshot = readonly { readonly id: string }[];
/**
 * A global time operation's restore plan, as produced by `executeGlobalTimeOperation`.
 * Opaque here on purpose: the owning module encodes plans through its own codec, and
 * the only operations the command layer performs on one are transport and application.
 */
export type TimeOperationRestorePlanSnapshot = { readonly version: unknown };
export type TrackGroupMembershipSnapshot = { readonly trackId: string; readonly groupId: string | null };
export type TrackHeightSnapshot = { readonly trackId: string; readonly height: number };
/**
 * One track's clip collection plus the MIDI satellite state those clips own. Clip
 * edits that rewrite a whole track — cut, paste, strip silence, flatten, bounce —
 * cannot be inverted by replaying a counter-edit, so they carry this instead.
 */
/**
 * The track-level fields a collection rewrite overwrites alongside `clips`.
 * `flattenTrack` replaces all eight; a `destination: 'replace'` bounce empties
 * `devices`. Restoring `clips` without these hands back the right clips on a track
 * that lost its kind, its instrument and insert chain, its frozen take, and its
 * alternative lanes — a state the user never authored.
 */
export type TrackCollectionAlternativeSnapshot = {
    readonly id: string;
    /** Declared because `captureTrackClipStates` clones the whole live alternative and
     *  the restore writes the whole object back — so the name has always travelled and
     *  always been restored, and a narrower declaration only hid it from the guard.
     *  `renameTrackAlternative` writes exactly this field. */
    readonly name: string;
    /** Whole clips, for the same reason `TrackClipStateSnapshot.clips` carries them:
     *  the restore replaces each alternative's clip array outright, so the guard has
     *  to be able to see an edit *inside* one of those clips, not just its id. */
    readonly clips: readonly ClipStateSnapshot[];
};
export type TrackCollectionFieldsSnapshot = {
    readonly kind: TrackKind;
    /** Declared wide enough to be *compared*, not just written back: the guarded
     *  restore refuses when a device was added, removed, reordered, bypassed or
     *  reparameterised since capture, and it can only see that through these fields. */
    readonly devices: readonly DeviceSnapshot[];
    readonly frozen: boolean;
    readonly frozenBufferId?: string;
    readonly freezeState: FreezeStateSnapshot['freezeState'];
    readonly activeAlternativeId: string;
    /** Each alternative's clips travel with it for the same reason: the restore
     *  replaces the whole alternative list, so an edit inside a non-active
     *  alternative has to be visible to the guard that authorises that write. */
    readonly alternatives: readonly TrackCollectionAlternativeSnapshot[];
};
export type TrackClipStateSnapshot = {
    readonly trackId: string;
    /**
     * Declared wide enough to be *compared*, not just written back — the same reason
     * `TrackCollectionFieldsSnapshot.devices` is. `captureTrackClipStates` has always
     * put whole cloned clips here and the restore has always written the whole array
     * back, so a narrower declaration only ever hid that from the guard: an id
     * sequence is byte-identical across every in-place clip edit, and a guard that
     * can read no more than the id authorises overwriting all of them.
     */
    readonly clips: readonly ClipStateSnapshot[];
    /** Everything the rewrite overwrites besides `clips`. See the type's own note. */
    readonly trackFields: TrackCollectionFieldsSnapshot;
    readonly midiNotesByClipId: Record<string, MidiNotesSnapshot>;
    readonly midiCcByClipId: Record<string, MidiCcSnapshot>;
    readonly midiPitchBendByClipId: Record<string, MidiPitchBendSnapshot>;
    /**
     * Gain envelopes and warp markers hang off clip identity, so `removeClip` —
     * reached by cut, and by whatever a paste displaces — deletes them outright.
     * Carried here for the same reason `captureTrackRemovalSnapshot` carries them.
     */
    readonly clipSatellites: readonly ClipSatelliteEntrySnapshot[];
    /** Clip-scoped automation lanes, deleted by the same `removeClipSatelliteData` path. */
    readonly clipAutomationLanes: readonly ClipAutomationLaneSnapshot[];
};
export type TrackAlternativeStateSnapshot = {
    readonly alternatives: readonly { readonly id: string }[];
    readonly activeAlternativeId: string | null;
    readonly clips: readonly ClipSnapshot[];
};
export type ScratchPadSectionSnapshot = { readonly id: string };
export type MarkerSectionSnapshot = { readonly id: string };
/** Everything `removeTrack` deletes, so one track can be put back exactly as it was. */
export type RestoreTrackPayloadSnapshot = {
    trackId: string;
    trackSnapshot: TrackSnapshot;
    trackName: string;
    trackKind: TrackKind;
    trackGain: number;
    trackParentId: string | null;
    trackIndex: number;
    /** Internal context compiled only for sibling restores captured by one atomic batch. */
    batchRestoreTracks?: readonly BatchRestoreTrackSnapshot[];
    wasSelected: boolean;
    routingPatches: readonly TrackRoutingPatchSnapshot[];
    automationLaneSnapshots: readonly AutomationLaneSnapshot[];
    clipSatellites: readonly ClipSatelliteEntrySnapshot[];
    midiNotesByClipId: Record<string, MidiNotesSnapshot>;
    midiCcByClipId: Record<string, MidiCcSnapshot>;
    midiPitchBendByClipId: Record<string, MidiPitchBendSnapshot>;
    takeLaneSnapshots: readonly TakeLaneSnapshot[];
    sidechainRouteSnapshots: readonly SidechainRouteSnapshot[];
    ownedModulatorSnapshots: readonly ModulatorSnapshot[];
    incomingModulationMappingSnapshots: readonly IncomingModulationMappingSnapshot[];
};
export type MidiClipCcSnapshot = {
    readonly id: string;
    readonly controller: number;
    readonly value: number;
    readonly beat: number;
    readonly channel: number;
};
export type MidiClipPitchBendSnapshot = {
    readonly id: string;
    readonly value: number;
    readonly beat: number;
    readonly channel: number;
};
export type MidiClipDataActionSnapshot = {
    readonly notes: { readonly present: boolean; readonly value: readonly MidiClipNoteSnapshot[] };
    readonly controlChanges: { readonly present: boolean; readonly value: readonly MidiClipCcSnapshot[] };
    readonly pitchBends: { readonly present: boolean; readonly value: readonly MidiClipPitchBendSnapshot[] };
};
export type MidiClipGlueActionSnapshot = {
    readonly clips: readonly {
        readonly clipId: string;
        readonly data: MidiClipDataActionSnapshot;
    }[];
    readonly migratedAbsoluteNoteClipIds: {
        readonly present: boolean;
        readonly value: readonly string[];
    };
};
export type ClipGlueActionSnapshot = {
    readonly trackId: string;
    readonly clips: readonly ClipStateSnapshot[];
    readonly clipOrder: readonly string[];
    readonly midi: MidiClipGlueActionSnapshot;
    readonly clipSatellites: readonly ClipSatelliteEntrySnapshot[];
    readonly clipAutomationLanes: readonly ClipAutomationLaneSnapshot[];
};
export type StripSilenceActionSnapshot = {
    readonly trackId: string;
    readonly clips: readonly ClipStateSnapshot[];
    readonly clipOrder: readonly string[];
    readonly clipSatellites: readonly ClipSatelliteEntrySnapshot[];
    readonly clipAutomationLanes: readonly ClipAutomationLaneSnapshot[];
};
export type ClipSplitActionSnapshot = {
    readonly trackId: string;
    readonly leftClip: ClipStateSnapshot;
    readonly rightClip: ClipStateSnapshot | null;
    readonly rightClipIndex: number;
    readonly sourceMidi: MidiClipDataActionSnapshot;
    readonly rightMidi: MidiClipDataActionSnapshot;
};
export type RippleShiftSnapshot = {
    readonly clipId: string;
    readonly origStartBeat: number;
    readonly origEndBeat: number;
    readonly automationDelta: number;
};
export type RipplePlanSnapshot = {
    readonly removedClips: readonly ClipSnapshot[];
    readonly shiftedClips: readonly RippleShiftSnapshot[];
    readonly clipSatellites: readonly ClipSatelliteEntrySnapshot[];
    readonly clipAutomationLanes: readonly ClipAutomationLaneSnapshot[];
};
export type AdjustmentLayerSnapshot = {
    readonly id: string;
    readonly name: string;
    readonly effectType:
        'eq' | 'compressor' | 'reverb' | 'delay' | 'saturation' | 'filter' | 'stereo-width' | 'volume' | 'pan';
    readonly parameters: readonly {
        readonly name: string;
        readonly value: number;
        readonly min: number;
        readonly max: number;
        readonly unit: string;
    }[];
    readonly affectedTrackIds: readonly string[];
    readonly insertionIndex: number;
    readonly regions: readonly {
        readonly id: string;
        readonly startBeat: number;
        readonly endBeat: number;
        readonly blend: number;
        readonly fadeInBeats: number;
        readonly fadeOutBeats: number;
    }[];
    readonly enabled: boolean;
    readonly mix: number;
    readonly color: string;
};
/** A pitch-shift segment carried by `commitPitchEdit`. Command cannot import Knead's
 *  segment model (model isolation), so this specifies only the structural fields the
 *  pitch render consumes. Kept assignable to Knead's mutable shape (plain arrays). */
export type PitchEditSegmentSnapshot = {
    start_time_ms: number;
    end_time_ms: number;
    shift_semitones: number;
};
/** A pitch-contour point carried by `commitPitchEdit`. Structural mirror of Knead's
 *  `PitchPoint` — model isolation forbids importing the concrete model. */
export type PitchContourPointSnapshot = {
    time_ms: number;
    frequency_hz: number;
    confidence: number;
    voiced: boolean;
};
/** The analysed pitch contour carried by `commitPitchEdit`. Structural mirror of Knead's
 *  `PitchContour`; arrays stay mutable so the payload is assignable where the render
 *  dependency expects Knead's concrete type. */
export type PitchContourSnapshot = {
    points: PitchContourPointSnapshot[];
    sample_rate: number;
    hop_size: number;
    algorithm?: string;
};
/** An editable Knead pitch blob carried by `restoreClipFileId` so undoing a pitch
 *  commit gives the user their edits back. Structural mirror of Knead's `NoteBlob`
 *  — model isolation forbids importing the concrete model.
 *
 *  Deliberately NOT the reduced blob shape on `ClipActionSnapshot.kneadState`: that
 *  one omits drift, vibrato, formant shift, gain and mute, and an undo restoring
 *  from it would silently discard those edits. A restore snapshot has to be lossless.
 *  `originalPitchCenterCents` stays optional because the persisted shape omits it. */
export type KneadPitchBlobSnapshot = {
    id: string;
    startTime: number;
    endTime: number;
    pitchCenterCents: number;
    originalPitchCenterCents?: number;
    pitchCurveCents: number[];
    voicedConfidence: number;
    driftPercent: number;
    vibratoDepthPercent: number;
    vibratoRateHz: number;
    formantShiftCents: number;
    gainDb: number;
    muted: boolean;
};

/** Structural mirror of a track's whole freeze aggregate — the two denormalized fields
 *  plus `freezeState` itself. Kept structural, like every other snapshot here, so this
 *  neutral contract does not depend on a model owned by the Arrangement module.
 *
 *  Captured and restored as one unit because the three drift apart if they are not:
 *  `frozen` and `frozenBufferId` are what playback and export read, `freezeState` is what
 *  staleness detection and the freeze UI read, and a restore that collapsed the aggregate
 *  to `unfrozen` would discard a `stale` or `error` state the forward action found. */
export type FreezeStateSnapshot = {
    readonly frozen: boolean;
    readonly frozenBufferId?: string;
    readonly freezeState: {
        readonly status: 'unfrozen' | 'freezing' | 'frozen' | 'stale' | 'error';
        readonly freezeId?: string;
        readonly frozenBufferId?: string;
        readonly frozenAudioHash?: string;
        readonly sourceContentHash?: string;
        readonly deviceChainHash?: string;
        readonly renderSettings?: {
            readonly sampleRate: number;
            readonly bitDepth: number;
            readonly channelCount: number;
            readonly tailLengthSeconds: number;
            readonly bakeVersion?: number;
        };
        readonly compensationSeconds?: number;
        readonly renderProgress?: number;
        readonly errorMessage?: string;
        readonly renderedAt?: number;
    };
};

export type AutomationMode = 'read' | 'write' | 'touch' | 'latch' | 'off';

export type SendAutomationRangeSnapshot = {
    sectionId: string;
    sectionName: string;
    startBeat: number;
    endBeat: number;
    automationStartBeat: number;
};

export type RenderProjectSectionJobSnapshot = {
    jobId: string;
    sectionId: string;
    sectionName: string;
    startBeat: number;
    endBeat: number;
    sampleRate: number;
    tailSeconds: number;
};

export type GrooveConsumerSnapshot = 'clip' | 'yeast-processor' | 'toaster-pattern' | 'arpeggiator' | 'sequencer';
export type GrooveTemplateActionSnapshot = {
    id: string;
    name: string;
    schemaVersion: 1;
    subdivision: '1/8' | '1/16' | '1/32' | '1/16T';
    slots: Array<{ index: number; timingOffset: number; dynamicsOffset: number }>;
    provenance:
        | { type: 'builtin'; sourceId: string }
        | { type: 'user'; sourceId: string }
        | { type: 'midi-clip'; sourceId: string; analyzerVersion: number }
        | { type: 'legacy'; sourceId: string };
};
export type GrooveAssignmentActionSnapshot = {
    consumerType: GrooveConsumerSnapshot;
    consumerId: string;
    templateId: string;
    amount: number;
};
export type ChordQualityActionSnapshot =
    | 'major'
    | 'minor'
    | 'dim'
    | 'aug'
    | 'sus2'
    | 'sus4'
    | '7'
    | 'maj7'
    | 'min7'
    | 'dim7'
    | 'aug7'
    | '6'
    | 'min6'
    | '9'
    | 'add9'
    | 'min9'
    | '7sus4';
export type ChordTrackActionSnapshot = {
    readonly enabled: boolean;
    readonly events: readonly {
        readonly id: string;
        readonly beat: number;
        readonly root: number;
        readonly quality: ChordQualityActionSnapshot;
        readonly duration: number;
    }[];
};
export type MidiMappingActionSnapshot = {
    readonly id: string;
    readonly channel: number;
    readonly cc: number;
    readonly targetType: 'trackGain' | 'trackPan' | 'deviceParam' | 'fermenterGlobalParam';
    readonly trackId?: string;
    readonly deviceId?: string;
    readonly paramId?: string;
    readonly minValue: number;
    readonly maxValue: number;
    readonly scaleMode?: 'linear' | 'log' | 'exp';
};
export type MidiLearnMappingsActionSnapshot = {
    readonly mappings: readonly MidiMappingActionSnapshot[];
};
export type DeletedGrooveTemplateActionSnapshot = {
    template: GrooveTemplateActionSnapshot;
    templateIndex: number;
    assignments: Array<{ index: number; assignment: GrooveAssignmentActionSnapshot }>;
};

type LegacyVcaGroupSnapshot = {
    readonly id: string;
    readonly name: string;
    readonly gain: number;
    readonly muted: boolean;
    readonly trackIds: readonly string[];
};

type LegacyVcaGroupRowState = {
    readonly group: LegacyVcaGroupSnapshot;
    readonly index: number;
} | null;

type LegacyVcaGroupRowPatch = {
    readonly groupId: string;
    readonly expected: LegacyVcaGroupRowState;
    readonly replacement: LegacyVcaGroupRowState;
};

type LegacyVcaGroupGainPatch = {
    readonly groupId: string;
    readonly expectedGain: number;
    readonly replacementGain: number;
};

type LegacyVcaGroupMembershipPatch = {
    readonly groupId: string;
    readonly trackId: string;
    readonly expectedIndices: readonly number[];
    readonly replacementIndices: readonly number[];
};

type LegacyVcaTrackMembershipPatch = {
    readonly trackId: string;
    readonly expectedVcaGroupId: string | null;
    readonly replacementVcaGroupId: string | null;
};

export type GeneratedMidiStateGuard = {
    entityJson: string;
    midiByClipIdJson: string;
};

export type DrumPreviewRecipe = 'ghost-note-pocket' | 'half-time-space' | 'syncopated-hats';

export type StemImportRole =
    | 'kick'
    | 'snare'
    | 'hi-hat'
    | 'tom'
    | 'percussion'
    | 'bass'
    | 'guitar-left'
    | 'guitar-right'
    | 'keys'
    | 'synth'
    | 'lead-vocal'
    | 'backing-vocal'
    | 'fx'
    | 'other';

export type StemImportTrackSnapshot = {
    readonly stemId: string;
    readonly sourceName: string;
    readonly role: StemImportRole;
    readonly sourceTempo: number;
    readonly durationSeconds: number;
    readonly sourceBytes: number;
    readonly decodedBytes: number;
    readonly audioBufferId: string;
    readonly assetHash?: string;
    readonly assetLeaseId?: string;
    readonly trackId: string;
    readonly trackName: string;
    readonly trackGain: number;
    readonly trackPan: number;
    readonly trackColor?: string;
    readonly trackAlternativeId?: string;
    readonly clipId: string;
};

export type DrumPreviewSourceClipSnapshot = {
    readonly trackId: string;
    readonly trackName: string;
    readonly expectedTrackFrozen: boolean;
    readonly clipId: string;
    readonly clipName: string;
    readonly expectedClipLocked: boolean;
    readonly expectedNotes: readonly MidiClipNoteSnapshot[];
};

export type DrumPreviewCandidateSnapshot = {
    readonly branchId: string;
    readonly branchName: string;
    readonly rootDocId: string;
    readonly recipe: DrumPreviewRecipe;
    readonly snareNotes: readonly MidiClipNoteSnapshot[];
    readonly hiHatNotes: readonly MidiClipNoteSnapshot[];
};

export type DrumPreviewBranchPlanSnapshot = {
    readonly ownerId: string;
    readonly createdAt: number;
    readonly expectedSourceBranchId: string;
    readonly expectedSourceHeads: readonly string[];
    readonly expectedDocuments: readonly {
        readonly docId: string;
        readonly heads: readonly string[];
    }[];
    readonly expectedBranchState: {
        readonly activeBranchId: string;
        readonly branches: readonly {
            readonly branchId: string;
            readonly name: string;
            readonly rootDocId: string;
            readonly sourceBranchId: string | null;
            readonly createdAt: number;
            readonly createdFromHeads: readonly string[];
            readonly note: string;
        }[];
    };
    readonly sectionId: string;
    readonly sectionName: string;
    readonly sectionStartBeat: number;
    readonly sectionEndBeat: number;
    readonly candidateCount: 3;
    readonly varyingRoles: readonly ['snare', 'hi-hat'];
    readonly kick: DrumPreviewSourceClipSnapshot;
    readonly snare: DrumPreviewSourceClipSnapshot;
    readonly hiHat: DrumPreviewSourceClipSnapshot;
    readonly candidates: readonly DrumPreviewCandidateSnapshot[];
};

export type DeleteDrumPreviewBranchesSnapshot = {
    readonly ownerId: string;
    readonly expectedSourceBranchId: string;
    readonly branches: readonly {
        readonly branchId: string;
        readonly branchName: string;
        readonly rootDocId: string;
        readonly expectedHeads: readonly string[];
    }[];
};

type MidiGenerationClipReplaySnapshot = {
    id: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: 'midi';
};

type MidiGenerationSourceReplaySnapshot = {
    trackId: string;
    clip: MidiGenerationClipReplaySnapshot;
    notes: MidiClipNoteSnapshot[];
};

type GeneratedMidiReplayOperation =
    | {
          kind: 'replace-notes';
          trackId: string;
          clip: MidiGenerationClipReplaySnapshot;
          expectedNotes: MidiClipNoteSnapshot[];
          replacementNotes: MidiClipNoteSnapshot[];
      }
    | {
          kind: 'create-clip';
          source: MidiGenerationSourceReplaySnapshot;
          targetTrackId: string;
          clip: MidiGenerationClipReplaySnapshot;
          notes: MidiClipNoteSnapshot[];
      }
    | {
          kind: 'create-track';
          source: MidiGenerationSourceReplaySnapshot;
          trackJson: string;
          trackIndex: number;
          clip: MidiGenerationClipReplaySnapshot;
          notes: MidiClipNoteSnapshot[];
      };

export type AppAction =
    | {
          type: 'importStemSet';
          payload: {
              selectionId: string;
              groupName: string;
              projectTempo: number;
              folderId: string;
              folderColor?: string;
              folderAlternativeId?: string;
              stems: StemImportTrackSnapshot[];
          };
      }
    | {
          /** Guarded inverse of one atomic stem-set import. */
          type: 'discardImportedStemSet';
          payload: {
              folderId: string;
              stemTrackIds: string[];
              guards: Array<{ trackId: string; generatedMidiStateGuard: GeneratedMidiStateGuard }>;
          };
      }
    | {
          type: 'addTrack';
          payload: {
              id?: string;
              name: string;
              kind: TrackKind;
              select?: boolean;
              /** Internal replay metadata; provider payloads cannot set this field. */
              color?: string;
              /** Internal replay metadata; provider payloads cannot set this field. */
              initialAlternativeId?: string;
              /** Internal replay metadata; provider payloads cannot set this field. */
              initialDeviceId?: string;
              /** Internal arrangement composition metadata; provider payloads cannot set this field. */
              parentId?: string;
              /** Internal arrangement composition metadata; provider payloads cannot set this field. */
              outputId?: string;
              /** Internal arrangement composition metadata; provider payloads cannot set this field. */
              withoutDefaultDevice?: boolean;
          };
      }
    | {
          type: 'removeTrack';
          payload: {
              trackId: string;
              expectedKind?: 'audio' | 'midi' | 'bus' | 'master' | 'folder';
              expectedMuted?: boolean;
              expectedClipIds?: readonly string[];
              expectedAlternativeClipIds?: readonly string[];
              expectedVcaGroupId?: string | null;
              expectedVcaMembershipGroupIds?: readonly string[];
          };
      }
    | {
          type: 'discardCreatedTrack';
          payload: { trackId: string; generatedMidiStateGuard?: GeneratedMidiStateGuard };
      }
    | {
          /** Inverse of `removeTrack`. Carries the removed track, every project reference
           *  rewritten by removal, and its satellite state. Emitted only by the
           *  `removeTrack` handler's `describe()` — not invoked directly. */
          type: 'restoreTrack';
          payload: RestoreTrackPayloadSnapshot;
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
          payload: { clipId: string; generatedMidiStateGuard?: GeneratedMidiStateGuard };
      }
    | { type: 'removeAllTracks'; payload?: undefined }
    | { type: 'renameTrack'; payload: { trackId: string; name: string; expectedName?: string } }
    | {
          type: 'createTrackAlternative';
          payload: { trackId: string; name: string; duplicateActive: boolean; alternativeId?: string };
      }
    | { type: 'switchTrackAlternative'; payload: { trackId: string; alternativeId: string } }
    | { type: 'renameTrackAlternative'; payload: { trackId: string; alternativeId: string; name: string } }
    | {
          type: 'deleteTrackAlternative';
          payload: { trackId: string; alternativeId: string; fallbackAlternativeId?: string };
      }
    | { type: 'selectTrack'; payload: { trackId: string } }
    | { type: 'muteTrack'; payload: { trackId: string; muted: boolean; expectedMuted: boolean } }
    | { type: 'soloTrack'; payload: { trackId: string; soloed: boolean } }
    | { type: 'toggleSoloSafe'; payload: { trackId: string } }
    | { type: 'setSoloSafe'; payload: { trackId: string; soloSafe: boolean } }
    | {
          type: 'restoreSoloSafe';
          payload: { trackId: string; expected: boolean; replacement: boolean };
      }
    | {
          type: 'armTrack';
          payload: {
              trackId: string;
              armed: boolean;
              /** Internal runtime-routing metadata. AiRuntime payload validation rejects these fields. */
              midiInputTrackId?: string | null;
              expectedMidiInputTrackId?: string | null;
              midiInputOwnerId?: string | null;
              expectedMidiInputOwnerId?: string | null;
          };
      }
    | {
          type: 'freezeTrack';
          payload: {
              trackId: string;
              /**
               * Application-owned id for the freeze this action mints, resolved before
               * dispatch so `describe()` can name the exact post-state its inverse guards
               * against. The rest of the resulting freeze metadata — content hash,
               * compensation, render settings — is only knowable after the offline render,
               * so the guard is this id: while the track still carries it, nothing has
               * re-frozen it since. AiRuntime payload validation rejects this field.
               */
              freezeId?: string;
          };
      }
    | { type: 'unfreezeTrack'; payload: { trackId: string } }
    | {
          /** Guarded inverse and redo of `freezeTrack` and `unfreezeTrack`, in both
           *  directions. Re-freezing is not an inverse of unfreeze: it re-renders the
           *  current source and mints a new take rather than restoring the prior one. And
           *  `unfreezeTrack` is not a complete inverse of freeze: `freezeTrack` also
           *  accepts `stale` and `error` states that may already reference a buffer, which
           *  a bare unfreeze would clear. This carries the whole freeze aggregate on both
           *  sides so either direction restores exactly what was there, and conflicts when
           *  the live track no longer matches `expected`. Emitted only by those two
           *  handlers' `describe()`. */
          type: 'restoreFreezeState';
          payload: {
              trackId: string;
              expected: FreezeStateSnapshot;
              replacement: FreezeStateSnapshot;
          };
      }
    | { type: 'flattenTrack'; payload: { trackId: string } }
    | { type: 'bounceInPlace'; payload: { trackId: string } }
    | { type: 'reorderTrack'; payload: { trackId: string; newIndex: number } }
    | {
          type: 'setTempo';
          payload: {
              bpm: number;
              /**
               * Internal undo/redo routing. A bare `setTempo` resolves its target from
               * the live playhead, which makes it position-dependent — replaying it as
               * an inverse would re-resolve against wherever the playhead has moved to
               * and rewrite a different tempo event. The inverse and redo actions
               * therefore name the tempo-map change the original write landed on.
               * AiRuntime payload validation rejects this field.
               */
              tempoChangeId?: string | null;
              /** Application-owned replay guard. AiRuntime payload validation rejects this field. */
              expectedBpm?: number;
          };
      }
    | {
          type: 'setTimeSignature';
          payload: {
              numerator: number;
              denominator: number;
              expectedNumerator?: number;
              expectedDenominator?: number;
          };
      }
    | { type: 'setPlayback'; payload: { playing: boolean } }
    | { type: 'togglePlayback'; payload?: undefined }
    | { type: 'stopPlayback'; payload?: undefined }
    | { type: 'toggleRecording'; payload?: undefined }
    | {
          type: 'setMasterGain';
          /**
           * `expectedPercent` is the master percent the caller measured before it
           * derived `gain`. When present the handler conflicts instead of writing
           * if the live percent has moved, so a fader change that lands between a
           * caller's snapshot and command admission is never silently clobbered.
           * Omit it for a direct, absolute set that should always win.
           */
          payload: { gain: number; expectedPercent?: number };
      }
    | {
          type: 'restoreMasterGain';
          payload: { expectedPercent: number; replacementPercent: number };
      }
    | { type: 'toggleLoop'; payload?: undefined }
    | { type: 'toggleMetronome'; payload?: undefined }
    | { type: 'setMetronomeVolume'; payload: { volume: number } }
    | { type: 'setLoopRegion'; payload: { startBeat: number; endBeat: number } }
    | { type: 'setLoopEnabled'; payload: { enabled: boolean } }
    | { type: 'setMetronomeEnabled'; payload: { enabled: boolean } }
    | {
          type: 'restoreLoopRegion';
          payload: { loopStart: number; loopEnd: number; isLooping: boolean };
      }
    | {
          type: 'addClip';
          payload: {
              /** Internal replay identity. AiRuntime payload validation rejects this field. */
              id?: string;
              trackId: string;
              startBeat: number;
              endBeat: number;
              name: string;
              type?: 'audio' | 'midi';
              audioBufferId?: string;
              /** Internal clip state. AiRuntime payload validation rejects these fields. */
              assetHash?: string;
              isGhost?: boolean;
              audioOffsetBeats?: number;
              midiOffsetBeats?: number;
              fadeInBeats?: number;
              fadeOutBeats?: number;
              gain?: number;
              color?: string;
              locked?: boolean;
              muted?: boolean;
              stretchMode?: 'off' | 'repitch' | 'timestretch';
              stretchRatio?: number;
              loopEnabled?: boolean;
              loopLength?: number;
              followAction?: 'stop' | 'play_next' | 'play_previous' | 'play_random' | 'play_first' | 'play_last';
          };
      }
    | { type: 'moveClip'; payload: { clipId: string; trackId: string; startBeat: number } }
    | {
          /** Internal guarded inverse for exact clip track membership and geometry. */
          type: 'restoreClipPlacement';
          payload: {
              clipId: string;
              expected: ClipMoveActionSnapshot;
              replacement: ClipMoveActionSnapshot;
          };
      }
    | { type: 'duplicateClip'; payload: { clipId: string; targetClipId?: string } }
    | { type: 'duplicateClipToNextBar'; payload: { clipId: string; targetClipId?: string } }
    | { type: 'duplicateTrack'; payload: { trackId: string; targetTrackId?: string; select?: boolean } }
    | { type: 'removeClip'; payload: { clipId: string } }
    | { type: 'renameClip'; payload: { clipId: string; name: string } }
    | {
          type: 'splitClip';
          payload: {
              clipId: string;
              beat: number;
              /** Internal deterministic replay metadata. AiRuntime rejects these fields. */
              resolvedBeat?: number;
              rightClipId?: string;
              targetNoteIds?: readonly string[];
          };
      }
    | {
          /** Guarded inverse/redo for splitClip. Emitted only by its handler. */
          type: 'restoreClipSplitState';
          payload: {
              clipId: string;
              rightClipId: string;
              expected: ClipSplitActionSnapshot;
              replacement: ClipSplitActionSnapshot;
          };
      }
    | { type: 'trimClipStart'; payload: { clipId: string; newStartBeat: number } }
    | { type: 'trimClipEnd'; payload: { clipId: string; newEndBeat: number } }
    | {
          type: 'addDevice';
          payload: {
              trackId: string;
              deviceType: string;
              afterDeviceId?: string;
              deviceId?: string;
              expectedDeviceIds?: readonly string[];
              /** Internal AI replay guard. Provider payloads cannot set this field. */
              expectedFrozen?: boolean;
          };
      }
    | { type: 'bypassDevice'; payload: { deviceId: string; bypassed: boolean } }
    | {
          type: 'removeDevice';
          payload: { deviceId: string; expectedTrackId?: string; expectedDeviceIds?: readonly string[] };
      }
    | {
          /** Inverse of `removeDevice`; emitted only from the device handler's pre-execute snapshot. */
          type: 'restoreDevice';
          payload: {
              trackId: string;
              deviceSnapshot: DeviceSnapshot;
              deviceIndex: number;
              expectedDeviceIds?: readonly string[];
              /** Internal grouped-history context for compositionally restoring sibling devices. */
              batchRestoreDevices?: readonly BatchRestoreDeviceSnapshot[];
          };
      }
    | {
          /**
           * Application-compiled device-chain move. The provider and presentation layers
           * supply only device identities; the Arrangement compiler owns this exact
           * project/topology binding and the handler retains it for undo/redo.
           */
          type: 'reorderDevices';
          payload: {
              trackId: string;
              deviceId: string;
              targetIndex: number;
              expectedBefore: {
                  id: string;
                  kind: TrackKind;
                  devices: readonly {
                      id: string;
                      type: string;
                      externalInstanceId?: string;
                      parameterIds: readonly string[];
                  }[];
              };
              /** Present on the initial application-issued command; replay uses topology guards. */
              expectedProjectRevision?: string;
          };
      }
    | {
          type: 'setDeviceParameter';
          payload: {
              deviceId: string;
              paramId: string;
              value: number;
              expectedTrackId?: string;
              expectedDeviceType?: string;
              expectedDeviceIds?: readonly string[];
              expectedValue?: number;
              expectedValuePresent?: boolean;
              expectedTrackFrozen?: boolean;
              /** Internal replay flag: restore the parameter map to an absent property. */
              deleteParameter?: boolean;
          };
      }
    | { type: 'setExternalPluginState'; payload: { deviceId: string; stateChunk: string } }
    | { type: 'setDeviceState'; payload: { deviceId: string; state: DeviceStateChunkSnapshot } }
    | {
          type: 'setGrandBouleDeviceState';
          payload: {
              deviceId: string;
              before: DeviceStateChunkSnapshot;
              after: DeviceStateChunkSnapshot;
          };
      }
    | {
          type: 'createBus';
          payload: {
              name: string;
              /** Internal replay identity. */ busId?: string;
              /** Internal replay metadata captured from the first committed bus. */ color?: string;
              /** Internal replay metadata captured from the first committed bus. */ initialAlternativeId?: string;
              /** Application-owned initial fader value; provider payloads cannot set this field. */ initialGain?: number;
              /** Application-owned replay guard for names that must remain unclaimed. */
              expectedAbsentTrackNames?: readonly string[];
              /** Application-owned replay guard for protected routes outside the mutation set. */
              expectedTrackOutputs?: readonly { trackId: string; outputId: string }[];
          };
      }
    | {
          type: 'createFolder';
          /** `folderTrackId` is application-owned: it is materialized before `describe` so the
           *  inverse can name the exact track this command appends. Providers cannot set it. */
          payload: { name: string; folderTrackId?: string };
      }
    | {
          type: 'setSend';
          payload: {
              trackId: string;
              busId: string;
              level: number;
              expectedLevel?: number;
              expectedPreFader?: boolean;
          };
      }
    | { type: 'setWorkspaceMode'; payload: { mode: 'arrange' | 'clip' } }
    | { type: 'openPreferencesDialog'; payload?: undefined }
    | { type: 'openMixer'; payload?: undefined }
    | { type: 'closeMixer'; payload?: undefined }
    | { type: 'toggleSidebar'; payload?: undefined }
    | { type: 'toggleInspector'; payload?: undefined }
    | { type: 'toggleChatPanel'; payload?: undefined }
    | { type: 'setTrackInput'; payload: { trackId: string; inputId: string | null } }
    | {
          /** Guarded inverse and redo of `setTrackInput`. Replaying the captured prior
           *  input unconditionally overwrites any routing change made between the forward
           *  action and the undo — locally or through collaboration. This carries the
           *  input the forward action left behind (`expected`) and the one to put back
           *  (`replacement`), and conflicts when the live track no longer matches.
           *  Emitted only by the `setTrackInput` handler's `describe()`. */
          type: 'restoreTrackInput';
          payload: { trackId: string; expected: string | null; replacement: string | null };
      }
    | { type: 'setEditingTool'; payload: { tool: string } }
    | {
          type: 'setMarqueeSelection';
          payload: { selection: { startBeat: number; endBeat: number; trackIds: string[] } | null };
      }
    | { type: 'addMarker'; payload: { beat: number; name: string; markerId?: string; color?: string } }
    | { type: 'removeMarker'; payload: { markerId: string } }
    | { type: 'setMarkerColor'; payload: { markerId: string; color: string; expectedColor?: string } }
    | {
          type: 'addSection';
          payload: { startBeat: number; endBeat: number; name: string; sectionId?: string; color?: string };
      }
    | { type: 'removeSection'; payload: { sectionId: string } }
    | { type: 'renameSection'; payload: { sectionId: string; name: string } }
    | {
          type: 'addAutomationLane';
          payload: { trackId: string; parameterId: string; parameterName: string; laneId?: string };
      }
    | {
          type: 'automateSendRange';
          payload: {
              trackIds: string[];
              busId: string;
              sectionName: string;
              reductionDb: number;
              busName?: string;
              sectionId?: string;
              startBeat?: number;
              endBeat?: number;
              expectedSends?: Array<{ trackId: string; level: number; preFader: boolean }>;
              expectedSection?: { name: string; startBeat: number; endBeat: number };
          };
      }
    | {
          type: 'automateSendRanges';
          payload: {
              trackIds: string[];
              busId: string;
              sectionIds: string[];
              tailBars: number;
              targetLevelDb: number;
              busName?: string;
              expectedTimeSignature?: [number, number];
              ranges?: SendAutomationRangeSnapshot[];
              expectedTracks?: Array<{
                  trackId: string;
                  trackName: string;
                  frozen: boolean;
                  automationMode: AutomationMode;
                  sendLevel: number;
                  sendPreFader: boolean;
              }>;
          };
      }
    | {
          /** Internal guarded inverse for `automateSendRanges`. */
          type: 'removeSendAutomationRanges';
          payload: {
              trackIds: string[];
              busId: string;
              sectionIds: string[];
              tailBars: number;
              targetLevelDb: number;
              busName: string;
              expectedTimeSignature: [number, number];
              ranges: SendAutomationRangeSnapshot[];
              expectedTracks: Array<{
                  trackId: string;
                  trackName: string;
                  frozen: boolean;
                  automationMode: AutomationMode;
                  sendLevel: number;
                  sendPreFader: boolean;
              }>;
          };
      }
    | {
          type: 'renderProjectSections';
          payload: {
              sectionIds: string[];
              jobs?: RenderProjectSectionJobSnapshot[];
          };
      }
    | {
          /** Internal guarded inverse for `renderProjectSections`. */
          type: 'removeRenderedProjectSections';
          payload: {
              sectionIds: string[];
              jobs: RenderProjectSectionJobSnapshot[];
          };
      }
    | {
          type: 'automateTrackGainRange';
          payload: {
              trackIds: string[];
              sectionName: string;
              gainDb: number;
              sectionId?: string;
              startBeat?: number;
              endBeat?: number;
              expectedTracks?: Array<{
                  trackId: string;
                  trackName: string;
                  gain: number;
                  automationMode: 'read' | 'write' | 'touch' | 'latch' | 'off';
                  frozen: boolean;
              }>;
              expectedSection?: { name: string; startBeat: number; endBeat: number };
          };
      }
    | {
          /** Internal guarded inverse for `automateTrackGainRange`. */
          type: 'removeTrackGainAutomationRange';
          payload: {
              trackIds: string[];
              sectionName: string;
              gainDb: number;
              sectionId: string;
              startBeat: number;
              endBeat: number;
              expectedTracks: Array<{
                  trackId: string;
                  trackName: string;
                  gain: number;
                  automationMode: 'read' | 'write' | 'touch' | 'latch' | 'off';
                  frozen: boolean;
              }>;
              expectedSection: { name: string; startBeat: number; endBeat: number };
          };
      }
    | {
          /** Internal guarded inverse for `automateSendRange`. */
          type: 'removeSendAutomationRange';
          payload: {
              trackIds: string[];
              busId: string;
              sectionName: string;
              reductionDb: number;
              busName: string;
              sectionId: string;
              startBeat: number;
              endBeat: number;
              expectedSends: Array<{ trackId: string; level: number; preFader: boolean }>;
              expectedSection: { name: string; startBeat: number; endBeat: number };
          };
      }
    | {
          /** Inverse of `addAutomationLane`, keyed by the exact id allocated before execute. */
          type: 'removeAutomationLane';
          payload: { laneId: string };
      }
    | { type: 'setAutomationLaneEnabled'; payload: { laneId: string; enabled: boolean } }
    | {
          type: 'addAutomationPoint';
          payload: {
              laneId: string;
              /** Command-owned stable identity for exact undo/redo. AiRuntime rejects provider input. */
              pointId?: string;
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
    | {
          type: 'removeShortMidiOverlaps';
          payload: {
              clipId: string;
              maximumOverlapMs: number;
              expectedTempo: number;
              expectedTrackId: string;
              trackName: string;
              expectedTrackFrozen: boolean;
              clipName: string;
              expectedClipLocked: boolean;
              expectedNotes: readonly MidiClipNoteSnapshot[];
          };
      }
    | {
          type: 'createDrumPreviewBranches';
          payload: DrumPreviewBranchPlanSnapshot;
      }
    | {
          /** Internal guarded inverse for `createDrumPreviewBranches`. */
          type: 'deleteDrumPreviewBranches';
          payload: DeleteDrumPreviewBranchesSnapshot;
      }
    | {
          type: 'copyMidiArticulations';
          payload: {
              trackId: string;
              sourceClipId: string;
              targetClipId: string;
              notePairs: readonly { readonly sourceNoteId: string; readonly targetNoteId: string }[];
              expectedSourceNotes: readonly MidiClipNoteSnapshot[];
              expectedTargetNotes: readonly MidiClipNoteSnapshot[];
              expectedTrackFrozen: boolean;
              expectedSourceClipLocked: boolean;
              expectedTargetClipLocked: boolean;
          };
      }
    | {
          /** Internal inverse for whole-clip MIDI note transforms. Provider payloads never carry snapshots. */
          type: 'restoreMidiClipNotes';
          payload: {
              clipId: string;
              notes: readonly MidiClipNoteSnapshot[];
              expectedNotes: readonly MidiClipNoteSnapshot[];
              /** Internal redo allowance for a newly recreated clip whose MIDI bucket does not exist yet. */
              allowMissingExpectedEmpty?: boolean;
              /** MF-03 replay eligibility captured from the approved source and clip topology. */
              articulationReplayGuard?: {
                  trackId: string;
                  sourceClipId: string;
                  expectedSourceNotes: readonly MidiClipNoteSnapshot[];
                  expectedTrackFrozen: boolean;
                  expectedSourceClipLocked: boolean;
                  expectedTargetClipLocked: boolean;
              };
              /** General guarded replay eligibility for deterministic whole-clip note transforms. */
              noteTransformReplayGuard?: {
                  trackId: string;
                  expectedTrackFrozen: boolean;
                  expectedClipLocked: boolean;
                  expectedTempo?: number;
              };
          };
      }
    | { type: 'quantizeNoteLengths'; payload: { clipId: string; gridSize: number } }
    | { type: 'transposeNotes'; payload: { clipId: string; semitones: number } }
    | {
          type: 'humanizeNotes';
          // `seed`/`velocityAmount` are optional and captured by the handler on
          // first execute, replayed on redo — kept in sync with
          // src/utils/handlerContract.ts and AiRuntime/models/RuntimeAction.ts.
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
    | { type: 'setTrackGain'; payload: { trackId: string; gain: number; expectedGain: number } }
    | { type: 'setTrackPan'; payload: { trackId: string; pan: number; expectedPan: number } }
    | { type: 'setTrackColor'; payload: { trackId: string; color: string; expectedColor?: string } }
    | { type: 'copyClip'; payload?: undefined }
    | { type: 'cutClip'; payload?: undefined }
    | { type: 'pasteClip'; payload?: undefined }
    | {
          type: 'setClipFade';
          payload: {
              clipId: string;
              fadeInBeats: number;
              fadeOutBeats: number;
              /** Internal stale-replay guards. AiRuntime payload validation rejects these fields. */
              expectedFadeInBeats?: number;
              expectedFadeOutBeats?: number;
          };
      }
    | { type: 'importMidiFile'; payload?: undefined }
    | { type: 'normalizeClip'; payload: { clipId: string; mode?: 'peak' | 'rms' | 'lufs'; targetDb?: number } }
    | {
          type: 'reverseClip';
          payload: {
              clipId: string;
              /**
               * Application-owned id for the reversed buffer this action mints, resolved
               * before dispatch so `describe()` can name the exact post-state its inverse
               * has to guard against. Minting it inside `execute` left the id unknowable
               * until after the undo entry was written. AiRuntime payload validation
               * rejects this field.
               */
              reversedBufferId?: string;
          };
      }
    | {
          /** Inverse and redo of `reverseClip`, in both directions. Reversing again is not
           *  self-inverse: each run mints a new buffer id, appends another name suffix and
           *  drops the clip's persisted pitch analysis, so undoing that way leaves changed
           *  metadata behind and destroys the user's Knead edits for good. This restores
           *  the buffer pointer, the name and the pitch analysis together, guarded on the
           *  buffer the forward action left behind (`expectedAudioBufferId`) so a newer
           *  edit conflicts instead of being overwritten. Emitted only by the
           *  `reverseClip` handler's `describe()`. */
          type: 'restoreReversedClip';
          payload: {
              clipId: string;
              expectedAudioBufferId: string;
              audioBufferId: string;
              name: string;
              blobs?: KneadPitchBlobSnapshot[];
              contour?: PitchContourSnapshot;
          };
      }
    | {
          type: 'glueClips';
          payload: {
              clipIds: string[];
              /** Internal deterministic replay fields. AiRuntime validation rejects these fields. */
              targetClipId?: string;
              expected?: ClipGlueActionSnapshot;
              replacement?: ClipGlueActionSnapshot;
          };
      }
    | {
          type: 'restoreClipGlueState';
          payload: {
              expected: ClipGlueActionSnapshot;
              replacement: ClipGlueActionSnapshot;
          };
      }
    | { type: 'nudgeClip'; payload: { clipId: string; beats: number } }
    | { type: 'crossfadeClips'; payload: { clipAId: string; clipBId: string; durationBeats?: number } }
    | {
          type: 'restoreCrossfadeClips';
          payload: {
              clipAId: string;
              clipBId: string;
              expected: {
                  clipAEndBeat: number;
                  clipAFadeOutBeats: number;
                  clipBStartBeat: number;
                  clipBFadeInBeats: number;
              };
              replacement: {
                  clipAEndBeat: number;
                  clipAFadeOutBeats: number;
                  clipBStartBeat: number;
                  clipBFadeInBeats: number;
              };
          };
      }
    | {
          type: 'setClipGain';
          payload: {
              clipId: string;
              gain: number;
              /** Application-owned replay guard. AiRuntime payload validation rejects this field. */
              expectedGain?: number;
          };
      }
    | { type: 'setClipColor'; payload: { clipId: string; color: string; expectedColor?: string } }
    | { type: 'lockClip'; payload: { clipId: string; locked: boolean; expectedLocked?: boolean } }
    | { type: 'consolidateSelection'; payload: { trackId: string; startBeat: number; endBeat: number } }
    | { type: 'bounceSelection'; payload: { trackId: string; startBeat: number; endBeat: number } }
    | { type: 'seekPlayhead'; payload: { beat: number } }
    | { type: 'setPunchIn'; payload: { beat: number } }
    | { type: 'setPunchOut'; payload: { beat: number } }
    | {
          type: 'setPunchEnabled';
          payload: {
              enabled: boolean;
              /** Internal compare-and-swap guard. AiRuntime payload validation rejects this field. */
              expectedEnabled?: boolean;
          };
      }
    | {
          /** Internal compare-and-swap replay action for both punch endpoints. */
          type: 'restorePunchRegion';
          payload: {
              expected: { punchInBeat: number; punchOutBeat: number };
              replacement: { punchInBeat: number; punchOutBeat: number };
          };
      }
    | { type: 'togglePunch'; payload?: undefined }
    | { type: 'toggleCountIn'; payload?: undefined }
    | { type: 'setCountInBars'; payload: { bars: number } }
    | { type: 'togglePreRoll'; payload?: undefined }
    | { type: 'setPreRollBars'; payload: { bars: number } }
    | { type: 'zoomTracksVertical'; payload: { delta: number } }
    | { type: 'addTimeSignatureChange'; payload: { beat: number; numerator: number; denominator: number } }
    | { type: 'removeTimeSignatureChange'; payload: { beat: number } }
    | {
          type: 'setTrackOutput';
          payload: { trackId: string; outputId: string; expectedOutputId?: string };
      }
    | {
          type: 'addSend';
          payload: { trackId: string; busId: string; level: number; preFader?: boolean; expectedAbsent?: true };
      }
    | {
          type: 'removeSend';
          payload: { trackId: string; busId: string; expectedLevel?: number; expectedPreFader?: boolean };
      }
    | {
          type: 'removeAutomationPoint';
          payload: {
              laneId: string;
              pointIndex: number;
              /** Internal stable target. AiRuntime rejects provider input. */
              pointId?: string;
          };
      }
    | {
          type: 'setAutomationMode';
          payload: { trackId: string; mode: AutomationMode; expectedMode?: AutomationMode };
      }
    | { type: 'hideTrack'; payload: { trackId: string; hidden: boolean } }
    | { type: 'disableTrack'; payload: { trackId: string; disabled: boolean } }
    | {
          /** Guarded inverse and redo of `disableTrack`. Negating the requested value is
           *  not an inverse: dispatching `disabled: true` at an already-disabled track
           *  changes nothing, so replaying `disabled: false` on undo would write state the
           *  forward action never wrote. This carries the value the forward action left
           *  behind (`expected`) and the value to put back (`replacement`), and refuses
           *  when the live track no longer matches — so a newer edit is reported as a
           *  conflict instead of being silently overwritten. Emitted only by the
           *  `disableTrack` handler's `describe()`. */
          type: 'restoreTrackDisabled';
          payload: { trackId: string; expected: boolean; replacement: boolean };
      }
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
           *  directly. Keep mirrored in src/utils/handlerContract.ts and
           *  AiRuntime/models/RuntimeAction.ts. */
          type: 'restoreAutomationLanePoints';
          payload: {
              laneId: string;
              points: readonly AutomationPointSnapshot[];
              expectedPoints?: readonly AutomationPointSnapshot[];
          };
      }
    | {
          type: 'loadPreset';
          payload: {
              /** Preset-catalog identity retained for an execution-time authority check. */
              presetId: string;
              /** Application-owned target; omitted only before the preset compiler expands a new-track batch. */
              trackId: string;
              /** Captured ordered live/project chain before the one preset replacement. */
              expectedBefore: DeviceChainTopologySnapshot;
              /** Rejects a collaborator change before the project write. Consumed on first application. */
              expectedProjectRevision?: string;
              expectedFrozen: boolean;
              /** Exact app-materialized chain: ids, order, type, parameter schema and values. */
              devices: readonly DeviceSnapshot[];
          };
      }
    | {
          /** Internal guarded inverse emitted by `loadPreset`; never a presentation or provider command. */
          type: 'restorePresetDeviceChain';
          payload: {
              trackId: string;
              expectedBefore: DeviceChainTopologySnapshot;
              expectedFrozen: boolean;
              replacementDevices: readonly DeviceSnapshot[];
          };
      }
    | { type: 'savePreset'; payload: { trackId: string; name: string; category: string } }
    | {
          type: 'generateDrumPattern';
          payload: {
              style: string;
              trackId?: string;
              bars?: number;
              density?: number;
              startBeat?: number;
              seed?: number;
          };
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
              seed?: number;
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
              seed?: number;
          };
      }
    | { type: 'setClipLoop'; payload: { clipId: string; enabled: boolean } }
    | {
          /** Internal exact-state replay for optional clip loop metadata. */
          type: 'restoreClipLoop';
          payload: {
              clipId: string;
              expected: { present: boolean; enabled: boolean };
              replacement: { present: boolean; enabled: boolean };
          };
      }
    | { type: 'setClipLoopLength'; payload: { clipId: string; loopLength: number } }
    | {
          /** Internal exact-state replay for optional clip loop-length metadata. */
          type: 'restoreClipLoopLength';
          payload: {
              clipId: string;
              expected: { present: boolean; value: number };
              replacement: { present: boolean; value: number };
          };
      }
    | {
          type: 'createGrooveTemplate';
          payload: Omit<GrooveTemplateActionSnapshot, 'schemaVersion'>;
      }
    | { type: 'renameGrooveTemplate'; payload: { templateId: string; name: string } }
    | {
          type: 'restoreGrooveTemplateName';
          payload: { templateId: string; name: string; expectedName: string };
      }
    | { type: 'deleteGrooveTemplate'; payload: { templateId: string } }
    | { type: 'restoreDeletedGrooveTemplate'; payload: DeletedGrooveTemplateActionSnapshot }
    | { type: 'assignGrooveTemplate'; payload: GrooveAssignmentActionSnapshot }
    | {
          type: 'restoreGrooveAssignment';
          payload: {
              consumerType: GrooveConsumerSnapshot;
              consumerId: string;
              assignment: GrooveAssignmentActionSnapshot | null;
              expectedAssignment?: GrooveAssignmentActionSnapshot;
          };
      }
    | {
          type: 'extractGroove';
          payload: {
              clipId: string;
              templateId?: string;
              sourceName?: string;
              subdivision?: string;
          } & (
              | { proposal: GrooveTemplateActionSnapshot; sourceRevision: string }
              | { proposal?: undefined; sourceRevision?: undefined }
          );
      }
    | { type: 'applyGroove'; payload: { clipId: string; grooveId: string; amount?: number } }
    | { type: 'setClipStretchMode'; payload: { clipId: string; mode: 'off' | 'repitch' | 'timestretch' } }
    | { type: 'setClipStretchRatio'; payload: { clipId: string; ratio: number } }
    | {
          /** Internal guarded inverse for exact clip-stretch state and repitch geometry. */
          type: 'restoreClipStretchState';
          payload: {
              clipId: string;
              expected: ClipStretchStateSnapshot;
              replacement: ClipStretchStateSnapshot;
          };
      }
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
    | {
          /** Applies a manual pitch-shift render to an audio clip and swaps the clip's
           *  file pointer to the rendered output. Flows through `executeAppAction`; its
           *  handler's `describe()` emits `restoreClipFileId` as the inverse. */
          type: 'commitPitchEdit';
          payload: {
              clipId: string;
              segments: PitchEditSegmentSnapshot[];
              contour: PitchContourSnapshot;
          };
      }
    | {
          /** Inverse of `commitPitchEdit`. Restores everything the commit consumed:
           *  the clip's file pointer, the buffer it plays from, and the pitch analysis
           *  (contour plus the user's edited blobs) the commit dropped. Restoring the
           *  pointers alone would leave the clip un-analysed and the user's blob edits
           *  gone — a lossy undo. Emitted only by the `commitPitchEdit` handler's
           *  `describe()`. Every field past `clipId` is optional: the commit skips the
           *  buffer repoint on the native render path, and a clip can legitimately have
           *  had no blobs or no contour. */
          type: 'restoreClipFileId';
          payload: {
              clipId: string;
              fileId: string;
              audioBufferId?: string;
              blobs?: KneadPitchBlobSnapshot[];
              contour?: PitchContourSnapshot;
          };
      }
    | { type: 'muteClip'; payload: { clipId: string; muted: boolean; expectedMuted?: boolean } }
    | { type: 'clearSolos'; payload?: undefined }
    | {
          type: 'restoreTrackSoloStates';
          payload: {
              expected: { trackId: string; soloed: boolean }[];
              replacement: { trackId: string; soloed: boolean }[];
          };
      }
    | { type: 'setTrackNotes'; payload: { trackId: string; notes: string } }
    | { type: 'deleteTime'; payload: { startBeat: number; endBeat: number } }
    | { type: 'insertTime'; payload: { atBeat: number; durationBeats: number } }
    | { type: 'duplicateTimeRange'; payload: { startBeat: number; endBeat: number } }
    | {
          /** Inverse of a global time operation. The operation is not self-inverse —
           *  deleting time discards what it shifted over — so the forward handler hands
           *  its own restore plan here rather than replaying a counter-operation. The
           *  plan carries expected-and-replacement state and conflicts on divergence. */
          type: 'restoreTimeOperationState';
          payload: { plan: TimeOperationRestorePlanSnapshot };
      }
    | {
          /** Inverse of `zoomTracksVertical`. Zooming clamps every track's height into a
           *  fixed range, so the opposite delta does not return a track that hit a bound
           *  to the height it had. The prior heights are carried instead. */
          type: 'restoreTrackHeights';
          payload: { expected: readonly TrackHeightSnapshot[]; replacement: readonly TrackHeightSnapshot[] };
      }
    | {
          /** Inverse of `groupTracks` / `ungroupTracks`. Grouping rewrites `groupId` on
           *  every named track, and the tracks were not necessarily ungrouped before, so
           *  the inverse restores the prior membership map instead of ungrouping. */
          type: 'restoreTrackGroupMemberships';
          payload: {
              expected: readonly TrackGroupMembershipSnapshot[];
              replacement: readonly TrackGroupMembershipSnapshot[];
          };
      }
    | {
          /** Inverse of `removeAllTracks`. Carries one `restoreTrack` payload per removed
           *  track so the whole arrangement returns as a single undo unit, in the track
           *  order it had before removal. */
          type: 'restoreTracks';
          payload: { restores: readonly RestoreTrackPayloadSnapshot[] };
      }
    | {
          /** Inverse of clip-collection rewrites (cut, paste, strip silence, flatten,
           *  consolidate). Replaying the forward edit cannot restore what it discarded,
           *  so each affected track's clips and MIDI satellites are carried whole and
           *  restored only while the live state still matches `expected`. */
          type: 'restoreTrackClipStates';
          payload: {
              expected: readonly TrackClipStateSnapshot[];
              replacement: readonly TrackClipStateSnapshot[];
          };
      }
    | {
          /** Inverse of track-creating commands (`createFolder`, `loadTrackTemplate`).
           *  The created ids are materialized before `describe`, so the inverse names
           *  exactly the tracks the command appended and no later sibling. */
          type: 'discardCreatedTracks';
          payload: { trackIds: readonly string[] };
      }
    | {
          /** Inverse of `createCompGroup`. Removes exactly the materialized group and
           *  restores the previously active group id, which creation overwrote. */
          type: 'discardCreatedCompGroup';
          payload: { groupId: string; expectedActiveGroupId: string | null; replacementActiveGroupId: string | null };
      }
    | {
          /** Inverse of `deleteTrackAlternative`. Deletion drops the alternative, may
           *  promote a different one and rewrites the track's live clips, so all three
           *  are restored together under a guard on the current alternative set. */
          type: 'restoreTrackAlternativeState';
          payload: {
              trackId: string;
              expected: TrackAlternativeStateSnapshot;
              replacement: TrackAlternativeStateSnapshot;
          };
      }
    | {
          /** Inverse of `clearScratchPad` / `commitScratchPad`. Both discard authored
           *  state — the pad's sections, or the arrangement's existing marker sections —
           *  and neither is replayable, so both collections are carried and guarded. */
          type: 'restoreScratchPadState';
          payload: {
              expectedSections: readonly ScratchPadSectionSnapshot[];
              replacementSections: readonly ScratchPadSectionSnapshot[];
              expectedMarkerSections: readonly MarkerSectionSnapshot[];
              replacementMarkerSections: readonly MarkerSectionSnapshot[];
          };
      }
    | {
          type: 'stripSilence';
          payload: {
              clipId: string;
              threshold?: number;
              minDuration?: number;
              /** Internal deterministic replay metadata. AiRuntime rejects these fields. */
              expected?: StripSilenceActionSnapshot;
              replacement?: StripSilenceActionSnapshot;
          };
      }
    | {
          type: 'restoreStripSilenceState';
          payload: {
              expected: StripSilenceActionSnapshot;
              replacement: StripSilenceActionSnapshot;
          };
      }
    | { type: 'detectTempo'; payload: { clipId: string } }
    | { type: 'detectKey'; payload: { clipId: string } }
    | { type: 'consolidateAllTracks'; payload?: undefined }
    | {
          type: 'arpeggiate';
          payload: {
              clipId: string;
              pattern?: string;
              rate?: number;
              octaves?: number;
              gate?: number;
              /** Application-owned EX-07 scope and compare-and-swap state. Provider payloads cannot carry these. */
              expectedTrackId?: string;
              trackName?: string;
              expectedTrackFrozen?: boolean;
              clipName?: string;
              expectedClipLocked?: boolean;
              expectedNotes?: readonly MidiClipNoteSnapshot[];
              addedNotes?: readonly MidiClipNoteSnapshot[];
          };
      }
    | {
          type: 'addSidechainRoute';
          payload: {
              sourceTrackId: string;
              targetTrackId: string;
              /** Command-owned replay identity and route snapshot fields. AiRuntime may select an app-scoped device. */
              routeId?: string;
              targetDeviceId?: string;
              targetParameterId?: string;
              gain?: number;
          };
      }
    | {
          type: 'removeSidechainRoute';
          payload: {
              sourceTrackId: string;
              targetTrackId: string;
              /** Command-owned replay identity and exact removed route snapshot. AiRuntime exposes only endpoints. */
              routeId?: string;
              targetDeviceId?: string;
              targetParameterId?: string;
              gain?: number;
          };
      }
    | { type: 'bounceToNewTrack'; payload: { trackId: string } }
    | { type: 'saveTrackTemplate'; payload: { trackId: string; name: string; category: string } }
    | { type: 'loadTrackTemplate'; payload: { templateId: string } }
    | { type: 'deleteTrackTemplate'; payload: { templateId: string } }
    | { type: 'createProjectFromTemplate'; payload: { templateId: string } }
    | {
          type: 'setProductionBrief';
          payload: {
              expectedRevision: number;
              brief: unknown;
          };
      }
    | {
          type: 'createVcaGroup';
          payload: {
              name: string;
              trackIds: string[];
              /** Command-owned replay identity. AiRuntime deliberately does not expose it. */
              vcaGroupId?: string;
          };
      }
    | { type: 'assignToVca'; payload: { trackId: string; vcaGroupId: string } }
    | { type: 'removeFromVca'; payload: { trackId: string } }
    | { type: 'setVcaGain'; payload: { vcaGroupId: string; gain: number } }
    | {
          /** Internal inverse only: conditionally restores the fields touched by one
           *  legacy VCA action. This is not a canonical/user/AI VCA action and is absent
           *  from RuntimeAction. */
          type: 'restoreLegacyVcaState';
          payload: {
              groupRows: readonly LegacyVcaGroupRowPatch[];
              groupGains: readonly LegacyVcaGroupGainPatch[];
              groupMemberships: readonly LegacyVcaGroupMembershipPatch[];
              trackMemberships: readonly LegacyVcaTrackMembershipPatch[];
          };
      }
    | { type: 'setMidiOutput'; payload: { trackId: string; destinationTrackId: string } }
    | { type: 'clearMidiOutput'; payload: { trackId: string } }
    | {
          /** Guarded inverse and redo of `setMidiOutput` and `clearMidiOutput`, in both
           *  directions. Replaying the captured prior destination through a bare set or
           *  clear overwrites any routing change made between the forward action and the
           *  undo. This carries the destination the forward action left behind
           *  (`expected`) and the one to put back (`replacement`) — `null` meaning no
           *  route — and conflicts when the live track no longer matches. Emitted only by
           *  those two handlers' `describe()`. */
          type: 'restoreMidiOutput';
          payload: { trackId: string; expected: string | null; replacement: string | null };
      }
    | {
          type: 'addNotes';
          payload: {
              clipId: string;
              notes: Array<{
                  /** Internal replay identity. Provider note validation rejects this field. */
                  id?: string;
                  pitch: number;
                  startBeat: number;
                  duration: number;
                  velocity?: number;
              }>;
          };
      }
    | {
          type: 'completeMidi';
          payload: { clipId: string; direction?: 'forward' | 'backward'; bars?: number };
      }
    | { type: 'variationMidi'; payload: { clipId: string; amount?: number } }
    | { type: 'generateBassline'; payload: { clipId: string; style?: string; trackId?: string } }
    | { type: 'replayGeneratedMidi'; payload: { operation: GeneratedMidiReplayOperation } }
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
    | {
          type: 'addChordEvent';
          payload: { beat: number; root: number; quality: string; duration?: number; eventId?: string };
      }
    | { type: 'moveChordEvent'; payload: { eventId: string; beat: number } }
    | {
          type: 'updateChordEvent';
          payload: {
              eventId: string;
              root?: number;
              quality?: ChordQualityActionSnapshot;
              duration?: number;
          };
      }
    | { type: 'removeChordEvent'; payload: { eventId: string } }
    | { type: 'toggleChordTrack'; payload?: { enabled?: boolean } }
    | { type: 'clearChordTrack'; payload?: undefined }
    | {
          type: 'restoreChordTrackState';
          payload: { expected: ChordTrackActionSnapshot; replacement: ChordTrackActionSnapshot };
      }
    | { type: 'clearAllMidiMappings'; payload?: undefined }
    | { type: 'completeMidiLearn'; payload: { channel: number; cc: number; mappingId: string } }
    | { type: 'removeMidiMapping'; payload: { mappingId: string } }
    | {
          type: 'restoreMidiLearnMappings';
          payload: { expected: MidiLearnMappingsActionSnapshot; replacement: MidiLearnMappingsActionSnapshot };
      }
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
    | {
          type: 'createCompGroup';
          /** `groupId` is application-owned and materialized before `describe`, so the
           *  inverse names the created group rather than guessing the newest one. */
          payload: { name: string; trackIds: string[]; groupId?: string };
      }
    | { type: 'togglePunchRecording'; payload?: undefined }
    | { type: 'toggleLoopRecord'; payload: { slotId: string } }
    | { type: 'triggerScene'; payload: { column: number } }
    | { type: 'nextSetlistItem'; payload?: undefined }
    | { type: 'previousSetlistItem'; payload?: undefined }
    | { type: 'createAdjustmentLayer'; payload: { name: string; effectType: string; layerId?: string } }
    | { type: 'removeAdjustmentLayer'; payload: { layerId: string } }
    | { type: 'toggleAdjustmentLayer'; payload: { layerId: string } }
    | { type: 'setLayerParameter'; payload: { layerId: string; paramName: string; value: number } }
    | { type: 'setLayerMix'; payload: { layerId: string; mix: number } }
    | {
          type: 'addAdjustmentRegion';
          payload: {
              layerId: string;
              startBeat: number;
              endBeat: number;
              blend?: number;
              fadeInBeats?: number;
              fadeOutBeats?: number;
              regionId?: string;
              sourceRegionId?: string;
              sourceSection?: { id: string; name: string; startBeat: number; endBeat: number };
              targetSection?: { id: string; name: string; startBeat: number; endBeat: number };
              expectedLayer?: AdjustmentLayerSnapshot;
              expectedTracks?: Array<{ trackId: string; trackName: string; frozen: boolean }>;
          };
      }
    | {
          type: 'removeAdjustmentRegion';
          payload: {
              layerId: string;
              regionId: string;
              expectedRegion?: {
                  id: string;
                  startBeat: number;
                  endBeat: number;
                  blend: number;
                  fadeInBeats: number;
                  fadeOutBeats: number;
              };
              expectedTracks?: Array<{ trackId: string; trackName: string; frozen: boolean }>;
          };
      }
    | { type: 'moveAdjustmentRegion'; payload: { regionId: string; startBeat: number; endBeat: number } }
    | { type: 'setLayerFades'; payload: { regionId: string; fadeInBeats: number; fadeOutBeats: number } }
    | { type: 'setLayerAffectedTracks'; payload: { layerId: string; trackIds: string[] } }
    | { type: 'setLayerInsertionIndex'; payload: { layerId: string; insertionIndex: number } }
    | {
          type: 'restoreAdjustmentLayerMutation';
          payload: {
              layers: readonly AdjustmentLayerSnapshot[];
              expectedLayersFingerprint: string;
              freezeTransitions: Array<{
                  trackId: string;
                  previousStatus: 'frozen';
                  expectedSourceSignature: string;
              }>;
          };
      }
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
    | { type: 'setWarpPitchShift'; payload: { clipId: string; semitones: number } };

export type TrackKind = 'audio' | 'midi' | 'bus' | 'master' | 'folder';

export type AppActionType = AppAction['type'];

/** Result of a handler's `describe(action)` — the human label for the undo/history
 *  entry plus optional guarded inverse and redo actions. */
export type HandlerDescribeResult = {
    label: string;
    inverseAction?: AppAction | null;
    redoAction?: AppAction;
};

export type HandlerAfterCommit = () => void | Promise<void>;

type HandlerDeferredEffects =
    | {
          afterCommit?: undefined;
          afterAmbiguousCommit?: undefined;
          afterRuntimeExecution?: undefined;
      }
    | {
          /** External effects that must happen only after the owning project transaction commits. */
          afterCommit: HandlerAfterCommit;
          /** Reconcile external state from durable project truth after an ambiguous project commit. */
          afterAmbiguousCommit: HandlerAfterCommit;
          afterRuntimeExecution?: undefined;
      }
    | {
          afterCommit?: undefined;
          afterAmbiguousCommit?: undefined;
          /** Complete a runtime-only action after its applied state is already observable. */
          afterRuntimeExecution: HandlerAfterCommit;
      };

export type HandlerExecutionResult = {
    status: 'written' | 'no-write' | 'conflict';
} & HandlerDeferredEffects;

export type HandlerValidationContext = {
    readonly actions: readonly AppAction[];
    readonly actionIndex: number;
    /** Exact execution cancellation signal for long-running handler-owned follow-up work. */
    readonly signal?: AbortSignal;
    /** The same handler is projecting into an isolated CRDT workspace; live runtime effects must stay deferred. */
    readonly executionMode?: 'isolated-preview';
};

/** One dispatchable action's handler. Built via `createHandler` and merged into a module
 *  handler map by each `get<Module>Handlers` factory. */
type ActionHandlerCommon<Action extends AppAction> = {
    describe: (action: Action) => HandlerDescribeResult;
    /** Side-effect-free authoritative domain validation run for the whole batch before its first effect. */
    validate?: (action: Action, context: HandlerValidationContext) => boolean;
    /** Explicit action-specific proof that authoritative validation can safely reapply this action after target divergence. */
    canReapplyAfterDivergence?: (action: Action) => boolean;
    /** Resolve deterministic application-owned payload fields, without project/runtime writes, before hashing. */
    materializeCommandArguments?: (action: Action) => void;
    /** Capture an owner-provided rollback for non-CRDT pre-commit state before dispatch begins. */
    prepareAbort?: (action: Action) => HandlerAfterCommit;
    /** True when the canonical action is already reflected in project truth. */
    isNoop?: (action: Action) => boolean;
    /** False when transaction abort fully rolls back the write and no pre-commit external effect can run. */
    requiresAbortCompensation?: boolean;
    /** Runtime handlers execute outside Automerge and cannot join project-mutation batches. */
    executionKind?: 'project' | 'runtime';
    /** Actions whose preflight description depends on live state must not be combined with other batch writes. */
    batchExecution?: 'singleton';
    /** Why this handler is singleton-only, so explicit domain restrictions take precedence in rejection messages. */
    batchRestriction?: 'domain-singleton' | 'missing-validation';
    undoable: boolean;
};

export type ActionHandler<Action extends AppAction = AppAction> = ActionHandlerCommon<Action> &
    (
        | {
              /** Explicit certification that this synchronous project handler can run against an isolated CRDT projection. */
              previewExecution: 'isolated-project';
              execute: (action: Action, context?: HandlerValidationContext) => void | HandlerExecutionResult;
          }
        | {
              previewExecution?: undefined;
              execute: (
                  action: Action,
                  context?: HandlerValidationContext
              ) => void | HandlerExecutionResult | Promise<void | HandlerExecutionResult>;
          }
        | {
              /** Explicitly non-previewable because execution must cross a live runtime or external boundary. */
              previewExecution: 'unsupported-external';
              execute: (
                  action: Action,
                  context?: HandlerValidationContext
              ) => void | HandlerExecutionResult | Promise<void | HandlerExecutionResult>;
          }
    );

export type ExecuteOptions = {
    groupId?: string;
    groupLabel?: string;
    /** Recheck transient authority after queued CRDT work completes and before dispatch begins. */
    shouldExecute?: () => boolean;
    /** Exact caller-owned cancellation signal propagated to handler execution and deferred effects. */
    signal?: AbortSignal;
    source?: 'manual' | 'prompt' | 'voice' | 'ai';
    /**
     * When true, skip pushing an undo entry and action history entry — during
     * replay or migration, and for *performative* gestures that write project
     * truth without being edits (a mixer mute or solo held during a pass). The
     * action still runs inside its Automerge transaction and syncs normally;
     * only the claim on `actionHistoryStore` — a slot of the shared root
     * document, capped and evicting oldest — is declined.
     */
    skipUndo?: boolean;
    /** Opaque owner for CRDT writes made synchronously by this action. */
    snapshotTransaction?: object;
    /** When true, do not capture this execution in an active macro recording. */
    skipMacroRecording?: boolean;
};
