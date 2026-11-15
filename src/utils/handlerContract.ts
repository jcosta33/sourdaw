/**
 * Neutral cross-module handler contract. Houses the pure `AppAction` discriminated
 * union plus the `ActionHandler` / `HandlerDescribeResult` / `ExecuteOptions` types that
 * `createHandler` and every `get<Module>Handlers` factory build against. Lives in
 * `src/utils/` (not a domain module) so handler code across modules depends on this
 * neutral surface rather than on a type-only entry point in `Command/useCases`.
 * Snapshot payloads stay structural so this contract does not depend on concrete models
 * owned by other modules.
 */

import { type AgentRenderReceipt, type AgentWorkOwnerIdentity } from './agentRenderReceipt';
import { type AudioSourceSnapshot, type AudioSourceTile } from './audioSourceTime';

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
    readonly audioOffsetSeconds?: number;
    readonly audioUnwrappedOffsetSeconds?: number;
    readonly audioLoopStartSeconds?: number;
    readonly audioLoopPassEntrySeconds?: number;
    readonly audioLoopPassOriginBeat?: number;
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
    readonly loopOriginBeat?: number;
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
        readonly blobs: {
            readonly id: string;
            readonly startTime: number;
            readonly endTime: number;
            readonly pitchCenterCents: number;
            readonly originalPitchCenterCents?: number;
            readonly pitchCurveCents: number[];
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
/** A ripple-shifted neighbor's pre-gesture placement, captured for exact restore. */
export type ClipShiftSnapshot = {
    readonly clipId: string;
    readonly origStartBeat: number;
    readonly origEndBeat: number;
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
    /**
     * Wire union: the canonical ADR 0024 ids this build writes, plus the
     * pre-ADR legacy ids (`complex`, `texture`, `beats`) that versioned
     * command envelopes recorded by earlier builds still carry. Validation
     * admits the union; the satellite store decodes legacy ids back onto the
     * canonical set at the write boundary (`normalizeWarpState`), so
     * in-memory state always stays canonical.
     */
    readonly stretchMode: 'repitch' | 'phase-vocoder' | 'wsola' | 'complex' | 'texture' | 'beats';
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
/** A saved source owner is bounded by the original take region or base gap.
 * It never grants ownership of the rest of a lane's programme. */
export type CompAudioSourceOwnerSnapshot =
    | {
          readonly kind: 'take';
          readonly takeId: string;
          readonly startBeat: number;
          readonly endBeat: number;
          readonly audioSource?: AudioSourceSnapshot;
      }
    | {
          readonly kind: 'base';
          readonly clipId: string;
          readonly startBeat: number;
          readonly endBeat: number;
          readonly audioSource?: AudioSourceSnapshot;
      };

export type CompAudioSourceInputProof = {
    readonly clipId: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly digest: string;
    readonly media: { readonly audioBufferId?: string; readonly assetHash?: string };
};

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
    readonly expression?: MidiNoteExpressionSnapshot;
    /** Original recording pass, absent on legacy and manually edited notes. */
    readonly recordingPassIndex?: number;
};
export type MidiExpressionPointSnapshot = { readonly offsetBeats: number; readonly value: number };
export type MidiNoteExpressionSnapshot = {
    readonly pressure?: MidiExpressionPointSnapshot[];
    readonly slide?: MidiExpressionPointSnapshot[];
    readonly pitchBend?: MidiExpressionPointSnapshot[];
};
export type MidiCcSnapshot = readonly { readonly id: string }[];
export type MidiPitchBendSnapshot = readonly { readonly id: string }[];
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
    /**
     * The take lanes this snapshot's forward action retires — `removeClip` takes
     * the retired clip's takes with it, and only a capture made before that write
     * can put them back. Carried on the pre-removal snapshot; the post-removal
     * capture carries none. Optional so snapshots persisted before takes joined
     * this payload still decode; absent means the action retired no takes.
     */
    readonly retiredTakeLanes?: readonly RetiredTakeLaneSnapshot[];
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
    readonly channelScoped?: boolean;
};
export type MidiClipDataActionSnapshot = {
    readonly notes: { readonly present: boolean; readonly value: readonly MidiClipNoteSnapshot[] };
    readonly controlChanges: { readonly present: boolean; readonly value: readonly MidiClipCcSnapshot[] };
    readonly pitchBends: { readonly present: boolean; readonly value: readonly MidiClipPitchBendSnapshot[] };
};
/** Exact frozen copies and row placement admitted by one original-row edit. */
export type OriginalMidiTakeRowCopy = {
    readonly laneId: string;
    readonly takeId: string;
    readonly clipId: string;
    readonly sourceEntryBeat: number;
    readonly sourceEndBeat: number;
    readonly passLengthBeats: number;
    readonly recordingPassIndex?: number;
    readonly expectedSlotPresent: boolean;
    readonly replacementSlotPresent: boolean;
    readonly expectedNextRowId: string | null;
    readonly replacementNextRowId: string | null;
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
export type StripSilenceActionSnapshot = {
    readonly trackId: string;
    readonly clips: readonly ClipStateSnapshot[];
    readonly clipOrder: readonly string[];
    readonly clipSatellites: readonly ClipSatelliteEntrySnapshot[];
    readonly clipAutomationLanes: readonly ClipAutomationLaneSnapshot[];
};
/** One detected onset a transient quantize cut and moved: the slice it heads now starts at `toBeat`. */
export type TransientQuantizeMoveSnapshot = {
    readonly onsetIndex: number;
    readonly sliceClipId: string;
    /** The onset's position in the source file: the slice's exact `audioOffsetSeconds`. */
    readonly sourceSeconds: number;
    readonly confidence: number;
    readonly fromBeat: number;
    readonly toBeat: number;
};
/** One detected onset a transient quantize left uncut: `merged` when its grid point did not advance
 *  past the slice before it, `limit` when it fell past the onset cap. */
export type TransientQuantizeSkipSnapshot = {
    readonly onsetIndex: number;
    readonly reason: 'merged' | 'limit';
};
export type ClipSplitActionSnapshot = {
    /** Old clip-start tempo that authenticates audio source promotion on both replay facets. */
    readonly audioSourceTempoAtStart?: number;
    readonly trackId: string;
    readonly leftClip: ClipStateSnapshot;
    readonly rightClip: ClipStateSnapshot | null;
    readonly rightClipIndex: number;
    /** Relative insertion witnesses, refreshed only by a committed Undo. Absent in legacy captures. */
    readonly rightClipOrder?: string[];
    readonly sourceMidi: MidiClipDataActionSnapshot;
    readonly rightMidi: MidiClipDataActionSnapshot;
    /**
     * The source clip's gain envelope and warp state, already repartitioned
     * across both halves. Optional so split actions captured before satellites
     * joined this snapshot still decode. On the undo leg (`previous`) the list
     * carries an explicit null entry for the right clip id, so restoring it
     * clears the right half's satellites rather than leaving them behind.
     */
    readonly clipSatellites?: readonly ClipSatelliteEntrySnapshot[];
    /**
     * The right fragment's clip-scoped automation lanes, copied from the
     * source and clamped to its window. Scoped to the RIGHT clip id only —
     * the left half keeps its id and its lanes untouched. Optional so split
     * actions captured before lanes joined this snapshot still decode; the
     * pre-split side carries an explicit empty list, so restoring it retires
     * the copies rather than leaving them behind.
     */
    readonly clipAutomationLanes?: readonly ClipAutomationLaneSnapshot[];
};
export type RippleShiftSnapshot = {
    readonly clipId: string;
    readonly origStartBeat: number;
    readonly origEndBeat: number;
    readonly automationDelta: number;
    /** Complete shifted-clip lane membership, owner tracks and points after
     *  the forward ripple. Historical captures without this field can only
     *  authenticate an empty live automation scope. */
    readonly expectedAutomationLanes?: readonly ClipAutomationLaneActionSnapshot[];
};
/** A take captured inside a comp take lane — structural mirror of Arrangement's
 *  `Take`, declared here because model isolation forbids importing it. Arrays
 *  stay mutable so a snapshot is assignable where the take-lane store's
 *  concrete model is expected. */
export type TakeSnapshot = {
    id: string;
    clipId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    selected: boolean;
    sourceOffsetBeats?: number;
    sourceOffsetSeconds?: number;
    passAnchorSeconds?: number;
    passDepthSeconds?: number;
    passSourceEndSeconds?: number;
    passOriginBeat?: number;
    passOriginSourceSeconds?: number;
    /** Original recording pass, absent on legacy and manually made takes. */
    recordingPassIndex?: number;
    midiSource?: MidiTakeSourceSnapshot;
};
/** Plain wire value: MIDI owns validation and all row projection. */
export type MidiTakeSourceSnapshot = {
    readonly sourceClipId: string;
    readonly rows: MidiClipDataActionSnapshot;
    readonly sourceEntryBeat: number;
    readonly sourceEndBeat: number;
    readonly phaseHeadBeat: number;
    readonly passLengthBeats: number;
    /** The first source beat the take may read: where a Delete Time cut its head. Absent means unbounded. */
    readonly readStartBeat?: number;
    /** The exclusive source beat the take may read up to: where a Delete Time cut its tail. Absent means unbounded. */
    readonly readEndBeat?: number;
    /**
     * How far before `phaseHeadBeat` the take's loop occurrences count from:
     * the pass head less the media origin live comp playback counted the take
     * from when it was captured. Held relative to the pass head so it moves
     * with the take. Absent on sources captured before it was recorded.
     */
    readonly occurrenceOriginDepthBeats?: number;
};
/** A comp region naming a take — structural mirror of Arrangement's `CompRegion`. */
export type CompRegionSnapshot = {
    startBeat: number;
    endBeat: number;
    takeId: string;
    audioSource?: AudioSourceSnapshot;
};
/** A whole comp take lane — structural mirror of Arrangement's `TakeLane`. */
export type CompTakeLaneSnapshot = {
    id: string;
    trackId: string;
    automationLaneId?: string;
    takes: TakeSnapshot[];
    activeCompRegions: CompRegionSnapshot[];
    baseGapAudioSources?: AudioSourceTile[];
};

/** Source facets captured by the Arrangement owner before a tempo edit.
 * These are bounded value deltas, never replacement tracks or take lanes. */
export type TempoAudioClipFieldsSnapshot = Pick<
    ClipStateSnapshot,
    | 'audioOffsetSeconds'
    | 'audioUnwrappedOffsetSeconds'
    | 'audioLoopStartSeconds'
    | 'audioLoopPassEntrySeconds'
    | 'audioLoopPassOriginBeat'
>;
export type TempoAudioClipInputsSnapshot = Pick<
    ClipStateSnapshot,
    | 'startBeat'
    | 'endBeat'
    | 'audioBufferId'
    | 'assetHash'
    | 'audioOffsetBeats'
    | 'loopEnabled'
    | 'loopLength'
    | 'loopOriginBeat'
    | 'stretchMode'
    | 'stretchRatio'
>;
export type TempoAudioTakeFieldsSnapshot = Pick<
    TakeSnapshot,
    'sourceOffsetSeconds' | 'passOriginBeat' | 'passOriginSourceSeconds'
>;
export type TempoAudioTakeInputsSnapshot = Pick<
    TakeSnapshot,
    'startBeat' | 'endBeat' | 'sourceOffsetBeats' | 'passAnchorSeconds' | 'passDepthSeconds' | 'passSourceEndSeconds'
>;
export type TempoAudioSourcePresenceSnapshot =
    { readonly present: false } | { readonly present: true; readonly value: AudioSourceSnapshot };
export type TempoAudioSourcePromotionSnapshot = {
    readonly version: 1;
    readonly clips: readonly {
        readonly trackId: string;
        readonly collection: 'active' | 'alternative';
        readonly alternativeId: string;
        readonly clipId: string;
        readonly inputs: TempoAudioClipInputsSnapshot;
        readonly before: TempoAudioClipFieldsSnapshot;
        readonly after: TempoAudioClipFieldsSnapshot;
    }[];
    readonly takes: readonly {
        readonly trackId: string;
        readonly laneId: string;
        readonly takeId: string;
        readonly clipId: string;
        readonly inputs: TempoAudioTakeInputsSnapshot;
        readonly before: TempoAudioTakeFieldsSnapshot;
        readonly after: TempoAudioTakeFieldsSnapshot;
    }[];
    readonly regions: readonly {
        readonly trackId: string;
        readonly laneId: string;
        readonly takeId: string;
        readonly clipId: string;
        readonly startBeat: number;
        readonly endBeat: number;
        readonly before: TempoAudioSourcePresenceSnapshot;
        readonly after: TempoAudioSourcePresenceSnapshot;
    }[];
    readonly gaps: readonly {
        readonly trackId: string;
        readonly laneId: string;
        readonly clipId: string;
        readonly startBeat: number;
        readonly endBeat: number;
        readonly before: TempoAudioSourcePresenceSnapshot;
        readonly after: TempoAudioSourcePresenceSnapshot;
    }[];
    readonly gapFieldPresence: readonly {
        readonly trackId: string;
        readonly laneId: string;
        readonly before: boolean;
        readonly after: boolean;
    }[];
};
/** Exact root publication and source member, attached only after the producer commits. */
export type CommandSourceProof = { changeHash: string; memberId: string };

/** One lane a clip removal emptied or thinned, carried by `restoreClip` as it
 *  was before the removal together with the index it held, so undoing the
 *  removal can put the same lane back in the same place. */
export type RetiredTakeLaneSnapshot = {
    readonly laneIndex: number;
    readonly lane: CompTakeLaneSnapshot;
    /**
     * The take ids this removal actually retired from `lane`. An undo re-adds only
     * these, so a captured take absent from live for any other reason — a later
     * deletion projected in with no local undo entry — stays absent instead of
     * being resurrected. Optional so captures persisted before the field existed
     * still decode; absent means the removal recorded no ids and an undo re-adds
     * no take from this lane.
     */
    readonly retiredTakeIds?: readonly string[];
    /** Exact source tiles this retirement removed; absent on legacy captures. */
    readonly retiredBaseGapAudioSources?: readonly AudioSourceTile[];
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

export type GeneratedMidiStateGuard = {
    entityJson: string;
    midiByClipIdJson: string;
    /**
     * Canonical JSON of the generated entity's per-clip satellite entries (gain
     * envelope, warp state), captured by producers whose generation writes
     * satellites — a clip duplicate clones the source's. Absent means the guard
     * requires the entity to carry no satellites at all, the pre-satellite
     * contract. When present, the guard instead requires the satellites to be
     * exactly what generation left behind, so undo refuses only after the user
     * has actually edited them.
     */
    clipSatellitesJson?: string;
    /**
     * Canonical JSON of the clip-scoped automation lanes the generated clips
     * carry, captured by producers whose generation writes them — a clip
     * duplicate clones the source's lanes onto the copy. A separate field from
     * `clipSatellitesJson` because the lanes live in Automation's store, not
     * the Arrangement satellite pair; either field may be captured without the
     * other, and an absent one keeps that leg on the absence check.
     */
    clipAutomationLanesJson?: string;
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

/**
 * Content-bound authority over gesture automation recording for one static
 * parameter edit. A fader ride and a model-proposed "set this parameter" reach
 * the same setter, and the setter decides from live transport and automation
 * mode alone — so an edit issued while the transport plays in write/touch/latch
 * would open or extend a recording pass and let the next loop wrap or stop
 * flush it over the lane. `'suppressed'` travels with the command's own
 * arguments (runtime schema, digest, content hash, persisted undo entry) so the
 * decision cannot drift from the edit it belongs to, and so undo, redo and
 * replay of that edit stay equally silent. Absent means the ordinary manual
 * gesture behaviour.
 */
export type AutomationRecordingPolicy = 'suppressed';

type LegacyAppAction =
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
              /** Original clip slot. Older entries without it append. */
              clipIndex?: number;
              /** Original owner order; absent in legacy captures that carried only an index. */
              clipOrder?: readonly string[];
              ripplePlan: RipplePlanSnapshot | null;
              midiNotesSnapshot: MidiNotesSnapshot | null;
              midiCcSnapshot: MidiCcSnapshot | null;
              midiPitchBendSnapshot: MidiPitchBendSnapshot | null;
              /**
               * Take lanes the removed clips left, captured before removal.
               * Optional so restore entries persisted before takes joined this
               * payload still decode; absent means the removal retired none.
               */
              retiredTakeLanes?: readonly RetiredTakeLaneSnapshot[];
              retiredTakeSourceProof?: CommandSourceProof;
          };
      }
    | { type: 'addMarker'; payload: { beat: number; name: string; markerId?: string; color?: string } }
    | { type: 'removeMarker'; payload: { markerId: string } }
    | { type: 'setMarkerColor'; payload: { markerId: string; color: string; expectedColor?: string } }
    | {
          type: 'addSection';
          /** `index` is the slot in the section list to insert at (clamped to its length);
           *  absent appends. `removeSection`'s inverse sets it so undo restores the order. */
          payload: {
              startBeat: number;
              endBeat: number;
              name: string;
              sectionId?: string;
              color?: string;
              index?: number;
          };
      }
    | { type: 'removeSection'; payload: { sectionId: string } }
    | { type: 'renameSection'; payload: { sectionId: string; name: string } }
    | { type: 'renameMarker'; payload: { markerId: string; name: string } }
    | { type: 'moveMarker'; payload: { markerId: string; beat: number } }
    | { type: 'moveSection'; payload: { sectionId: string; startBeat: number } }
    | { type: 'resizeSection'; payload: { sectionId: string; startBeat: number; endBeat: number } }
    | { type: 'setSectionColor'; payload: { sectionId: string; color: string } }
    | { type: 'reorderSection'; payload: { sectionId: string; direction: 'left' | 'right' } }
    | {
          /** Internal guarded inverse for `reorderSection`: restores BOTH swapped
           *  sections' exact pre-reorder beat spans and list positions, the gap
           *  between them included. Emitted only by the reorder handler's
           *  `describe()` — never invoked directly. */
          type: 'restoreSectionBeats';
          payload: { sections: Array<{ sectionId: string; startBeat: number; endBeat: number; index: number }> };
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
          /** Inverse of `createCompGroup`. Removes exactly the materialized group and
           *  restores the previously active group id, which creation overwrote. */
          type: 'discardCreatedCompGroup';
          payload: { groupId: string; expectedActiveGroupId: string | null; replacementActiveGroupId: string | null };
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
    | { type: 'saveTrackTemplate'; payload: { trackId: string; name: string; category: string } }
    | { type: 'loadTrackTemplate'; payload: { templateId: string } }
    | { type: 'deleteTrackTemplate'; payload: { templateId: string } }
    | { type: 'commitScratchPad'; payload?: undefined }
    | { type: 'clearScratchPad'; payload?: undefined }
    | { type: 'removeScratchPadSection'; payload: { sectionId: string } }
    | { type: 'renameScratchPadSection'; payload: { sectionId: string; name: string } }
    | { type: 'reorderScratchPadSection'; payload: { sectionId: string; direction: 'left' | 'right' } }
    | { type: 'setScratchPadSectionColor'; payload: { sectionId: string; color: string } }
    | {
          type: 'createPatternInstance';
          payload: { sourceClipId: string; targetTrackId: string; startBeat: number; targetClipId?: string };
      }
    | { type: 'detachPatternInstance'; payload: { clipId: string } }
    | {
          /** Exact link-field replay; never replaces clip content or MIDI material. */
          type: 'restorePatternInstanceLink';
          payload: {
              clipId: string;
              trackId: string;
              expected: {
                  parentClipId: { present: false } | { present: true; value: string };
                  overrides: { present: false } | { present: true; value: Record<string, boolean> };
              };
              replacement: {
                  parentClipId: { present: false } | { present: true; value: string };
                  overrides: { present: false } | { present: true; value: Record<string, boolean> };
              };
          };
      }
    | { type: 'detectSongStructure'; payload: { trackId?: string } }
    | {
          type: 'createCompGroup';
          /** `groupId` is application-owned and materialized before `describe`, so the
           *  inverse names the created group rather than guessing the newest one. */
          payload: { name: string; trackIds: string[]; groupId?: string };
      }
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
      };

export type TrackKind = 'audio' | 'midi' | 'bus' | 'master' | 'folder';

/**
 * Open registry of app-action variants. Each owning module adds a key from its `events/`
 * folder; `legacy` holds the variants not yet moved.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
export interface AppActionRegistry {
    legacy: LegacyAppAction;
}

export type AppAction = AppActionRegistry[keyof AppActionRegistry];

export type AppActionType = AppAction['type'];

/** Result of a handler's `describe(action)` — the human label for the undo/history
 *  entry plus optional guarded inverse and redo actions. */
export type HandlerDescribeResult = {
    label: string;
    inverseAction?: AppAction | null;
    redoAction?: AppAction;
};

export type HandlerAfterCommit = () => void | Promise<void>;

export type HandlerPostCommitEffect =
    | { readonly kind: 'runtime-graph'; readonly remediation: 'retry' | 'repair' }
    | { readonly kind: 'external-effect'; readonly remediation: 'reconcile' | 'manual-repair' };

/** Runtime-only owner evidence; never serialized into actions or history. */
export type HandlerCommitValidation = {
    /** Authenticate only the authoritative owners this write was admitted against. */
    readonly beforeCommit: () => string | null;
    readonly documentId: string;
    /** Optional causal inspection of published truth immediately before the candidate opens.
     * Prospective validation must not query history on a backend with an open change. */
    readonly beforeMutation?: (document: Readonly<Record<string, unknown>>) => string | null;
    /** Runs against the prospective document inside its atomic storage change. */
    readonly validateDocument: (document: Readonly<Record<string, unknown>>) => string | null;
    /** Idempotent, nonthrowing cleanup once this handler's transaction has finished executing. */
    readonly release: () => void;
    /** Attach evidence from the exact owned publication before history becomes visible. */
    readonly afterPublication?: () => void;
};

type HandlerDeferredEffects =
    | {
          afterCommit?: undefined;
          afterAmbiguousCommit?: undefined;
          postCommitEffect?: undefined;
          afterRuntimeExecution?: undefined;
      }
    | {
          /** External effects that must happen only after the owning project transaction commits. */
          afterCommit: HandlerAfterCommit;
          /** Reconcile external state from durable project truth after an ambiguous project commit. */
          afterAmbiguousCommit: HandlerAfterCommit;
          /** Durable recovery classification recorded before the project transaction commits. */
          postCommitEffect?: HandlerPostCommitEffect;
          afterRuntimeExecution?: undefined;
      }
    | {
          afterCommit?: undefined;
          afterAmbiguousCommit?: undefined;
          postCommitEffect?: undefined;
          /** Complete a runtime-only action after its applied state is already observable. */
          afterRuntimeExecution: HandlerAfterCommit;
      };

export type HandlerExecutionResult = {
    status: 'written' | 'no-write' | 'conflict';
    /** Why a refusal refused, when the handler knows something the caller cannot
     *  read off the document — an argument outside the control's own law, say.
     *  Carried into the conflict the dispatcher raises so the caller learns the
     *  bound rather than only that the write did not happen. */
    reason?: string;
    /** Only a written project result may supply a commit guard. */
    commitValidation?: HandlerCommitValidation;
} & HandlerDeferredEffects;

export type HandlerValidationContext = {
    readonly actions: readonly AppAction[];
    readonly actionIndex: number;
    /** Original history identity when a producer refreshes a saved capture. */
    readonly undoEntryId?: string;
    /** Command-owned pending history identity, never an action argument or persisted capability. */
    readonly recordedRedo?: {
        readonly inverseAction: AppAction | null;
        readonly isCurrent: () => boolean;
    };
    /** Exact execution cancellation signal for long-running handler-owned follow-up work. */
    readonly signal?: AbortSignal;
    /** Caller-scoped telemetry for actual deferred work starts and for render receipts; never persisted as project truth. */
    readonly onDeferredEffectAttempt?: (attempt: HandlerDeferredEffectAttempt) => void;
    /** The caller's work identity, so a receipt this flight produces can be matched against the caller's live lease. */
    readonly workOwner?: AgentWorkOwnerIdentity | null;
    /** The same handler is projecting into an isolated CRDT workspace; live runtime effects must stay deferred. */
    readonly executionMode?: 'isolated-preview';
    /** Ephemeral Inspector preview owner; never part of persisted actions or replay. */
    readonly deviceParameterRuntimeAuthority?: {
        readonly trackId: string;
        readonly deviceId: string;
        readonly paramId: string;
        readonly owner: symbol;
        readonly isCurrent: () => boolean;
    };
};

export type HandlerMaterializationContext = Pick<
    HandlerValidationContext,
    'actions' | 'actionIndex' | 'undoEntryId' | 'recordedRedo'
> & {
    /** Previously prepared actions; the full raw caller batch remains in `actions`. */
    readonly preparedPrefix?: readonly AppAction[];
};

/** Neutral persisted-history shape supplied to an owning handler after Command
 *  has validated each action against its current operation contract. */
export type HandlerSessionActionEntry = {
    readonly id?: string;
    readonly action: AppAction;
    readonly inverseAction: AppAction | null;
    readonly redoAction?: AppAction;
};

export type HandlerDeferredEffectAttempt =
    | {
          readonly kind: 'work-attempt';
          readonly operation: AppActionType;
          readonly workId: string;
      }
    | {
          readonly kind: 'render-receipt';
          readonly operation: AppActionType;
          readonly workId: string;
          readonly receipt: AgentRenderReceipt;
      };

/** One dispatchable action's handler. Built via `createHandler` and merged into a module
 *  handler map by each `get<Module>Handlers` factory. */
type ActionHandlerCommon<Action extends AppAction> = {
    describe: (action: Action, context?: HandlerValidationContext) => HandlerDescribeResult;
    /** Side-effect-free authoritative domain validation run for the whole batch before its first effect. */
    validate?: (action: Action, context: HandlerValidationContext) => boolean;
    /** Why `validate` refused, read only after it has, so the batch conflict names the owner's reason rather than the bare operation. */
    validationRefusalReason?: (action: Action, context: HandlerValidationContext) => string | null;
    /** Explicit action-specific proof that authoritative validation can safely reapply this action after target divergence. */
    canReapplyAfterDivergence?: (action: Action, context?: HandlerValidationContext) => boolean;
    /**
     * Whether this handler's `execute` can genuinely refuse to write against a diverged
     * document — some path returns `{ status: 'conflict' }` or throws `AppActionConflictError`.
     * `executeAppAction` never calls `validate` at dispatch, so conflict capability is only
     * knowable from the handler that will actually run: many undoable handlers route through
     * `toHandlerExecutionResult` (`no-write | written`) and can never refuse. Undo step-over
     * (#2881) may advance onto an entry only when its inverse resolves to a flagged handler;
     * stepping onto an unflagged one risks silently overwriting the edit that caused the
     * conflict. A declared capability, not a derived one — see the registry honesty spec in
     * `Command/useCases/__tests__/` for the proof each flag owes. Distinct from
     * `canReapplyAfterDivergence`, which certifies reapplication inside an atomic batch.
     */
    canReportConflict?: boolean;
    /** Resolve deterministic application-owned payload fields, without project/runtime writes, before hashing. */
    materializeCommandArguments?: (action: Action, context?: HandlerMaterializationContext) => void;
    /**
     * `admission` captures batch authority before its snapshot wait. `execution` opts fresh project singleton
     * dispatches into materialization after that wait and cancellation, before admission guards and execution.
     * Runtime, supplied-envelope and authenticated Redo dispatches retain early materialization; compilation and
     * batch materialization are unchanged. Omission retains the existing early singleton behavior.
     */
    materializeCommandArgumentsAt?: 'admission' | 'execution';
    /** Owner-provided strict validation for a payload after application-owned materialization. */
    validateMaterializedCommandArguments?: (payload: unknown) => boolean;
    /** Owner-provided strict validation for an internal persisted replay payload. */
    validateSessionActionArguments?: (payload: unknown) => boolean;
    /** Capture an owner-provided rollback for non-CRDT pre-commit state before dispatch begins. */
    prepareAbort?: (action: Action, context?: HandlerValidationContext) => HandlerAfterCommit;
    /**
     * Called with this inverse action once a redo has replayed the entry it inverts.
     *
     * A forward replay re-creates what its inverse removes, and the state that
     * inverse captured at undo time is the record of what that identity carried
     * then — state a write landing between the undo and the redo is absent from
     * it. The redo replays with `skipUndo`, so no fresh description reaches an
     * entry and nothing else reconciles that record; this is where the inverse's
     * own owner does it.
     *
     * Only the inverse's handler is asked, so one inverse standing behind several
     * forward actions (a clip created by `addClip`, by a duplicate, or by an AI
     * generation route) carries exactly one reconciliation, not one per creator.
     */
    afterRedoReplay?: (action: Action) => void;
    /** True when the canonical action is already reflected in project truth. */
    isNoop?: (action: Action) => boolean;
    /** Owner-provided relationship validation for a persisted forward/inverse/redo entry. */
    validateSessionEntry?: (entry: HandlerSessionActionEntry) => boolean;
    /**
     * Called with a persisted entry this handler's forward action begins, once the undo session has
     * restored it and `validateSessionEntry` has accepted it, so the owner can re-establish replay
     * state that lives only in memory and so did not survive serialization.
     */
    restoreSessionEntry?: (entry: HandlerSessionActionEntry) => void;
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
    /** Observe actual deferred work starts and render receipts within this exact execution flight. */
    onDeferredEffectAttempt?: (attempt: HandlerDeferredEffectAttempt) => void;
    /** The caller's work identity, echoed on every receipt this flight produces. */
    workOwner?: AgentWorkOwnerIdentity | null;
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
    /** When true, coalesce this action into the previous undo entry's group (or generate a shared group if unset). */
    coalesceWithPrevious?: boolean;
    /** Opaque owner for CRDT writes made synchronously by this action. */
    snapshotTransaction?: object;
    /** When true, do not capture this execution in an active macro recording. */
    skipMacroRecording?: boolean;
};
