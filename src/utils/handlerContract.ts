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
import { type DeviceParameterValueUnit } from './deviceParameterValueUnit';
import { type TempoSourceClock } from './tempoSourceClock';

/** Identity-scoped row numbers captured by an executed slip or trim, without row snapshots. */
type MidiRowCoordinateCapture = {
    beatDelta: number;
    coordinates: {
        kind: 'note' | 'cc' | 'pitchBend';
        id: string;
        beforeBeat: number;
        afterBeat: number;
    }[];
};

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
export type ClipMoveActionSnapshot = {
    readonly trackId: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly automationLanes: readonly ClipAutomationLaneActionSnapshot[];
    readonly clipIndex?: number;
    readonly beforeClipId?: string;
    readonly afterClipId?: string;
};
/** One clip's target placement in a multi-clip move — the `moveClips` payload unit
 *  and the moved-clip half of its `restoreClipMoves` inverse. */
export type ClipMoveTarget = {
    readonly clipId: string;
    readonly trackId: string;
    readonly startBeat: number;
};
/** A ripple-shifted neighbor's pre-gesture placement, captured for exact restore. */
export type ClipShiftSnapshot = {
    readonly clipId: string;
    readonly origStartBeat: number;
    readonly origEndBeat: number;
};
/** The neighbor shifts one ripple insert produced — the ripple half of `discardDrawnClip`'s payload. */
export type ClipRippleInsertPlanSnapshot = {
    readonly shiftedClips: readonly ClipShiftSnapshot[];
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

export type CompAudioSourcePromotionSnapshot = {
    readonly expected: CompAudioSourceOwnerSnapshot;
    readonly replacement: CompAudioSourceOwnerSnapshot;
    readonly sourceInputs: CompAudioSourceInputProof;
};
export type CompAudioSourceFieldPresenceSnapshot = {
    readonly expected: boolean;
    readonly replacement: boolean;
};

export type CompSelectionSpanSnapshot = {
    readonly startBeat: number;
    readonly endBeat: number;
    readonly takeId: string;
    readonly audioSource?: AudioSourceSnapshot;
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
    /**
     * The take lanes this snapshot's forward action retires — `removeClip` takes
     * the retired clip's takes with it, and only a capture made before that write
     * can put them back. Carried on the pre-removal snapshot; the post-removal
     * capture carries none. Optional so snapshots persisted before takes joined
     * this payload still decode; absent means the action retired no takes.
     */
    readonly retiredTakeLanes?: readonly RetiredTakeLaneSnapshot[];
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

/** One original row, addressed through its selected take and admitted frozen copies. */
export type OriginalMidiTakeRowReplacementPayload = {
    /** Only a new forward request may capture; history carries immutable witnessed copies. */
    readonly copyScope?: 'capture' | readonly OriginalMidiTakeRowCopy[];
    readonly laneId: string;
    readonly takeId: string;
    readonly sourceClipId: string;
    readonly rowId: string;
    readonly expectedSlotPresent: boolean;
    readonly replacementSlotPresent: boolean;
} & (
    | {
          readonly rowKind: 'note';
          readonly expected: MidiClipNoteSnapshot | null;
          readonly replacement: MidiClipNoteSnapshot | null;
      }
    | {
          readonly rowKind: 'cc';
          readonly expected: MidiClipCcSnapshot | null;
          readonly replacement: MidiClipCcSnapshot | null;
      }
    | {
          readonly rowKind: 'bend';
          readonly expected: MidiClipPitchBendSnapshot | null;
          readonly replacement: MidiClipPitchBendSnapshot | null;
      }
);
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
/** The application-materialized plan a transient quantize applies. It is a strip-silence-shaped
 *  clip replacement, bound to the decoded source and the tempo clock it was detected against. */
export type TransientQuantizePlanSnapshot = {
    readonly source: { readonly audioBufferId: string; readonly sampleRate: number; readonly length: number };
    readonly clock: TempoSourceClock;
    readonly expected: StripSilenceActionSnapshot;
    readonly replacement: StripSilenceActionSnapshot;
    readonly moves: readonly TransientQuantizeMoveSnapshot[];
    readonly skipped: readonly TransientQuantizeSkipSnapshot[];
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
/** One lane's take and comp-region facets before and after a clip transform —
 *  structural mirror of Arrangement's `TakeReKeyLaneTransition`, declared here
 *  because model isolation forbids importing it. */
export type TakeReKeyLaneTransitionSnapshot = {
    laneId: string;
    trackId: string;
    takesBefore: TakeSnapshot[];
    takesAfter: TakeSnapshot[];
    regionsBefore: CompRegionSnapshot[];
    regionsAfter: CompRegionSnapshot[];
    baseGapAudioSourcesBefore?: AudioSourceTile[];
    baseGapAudioSourcesAfter?: AudioSourceTile[];
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

/** An audio clip's canonical source clock, captured whole by an edit's inverse
 * and redo. Each key absent here is restored absent. */
export type ClipAudioSourceSnapshot = Pick<
    ClipStateSnapshot,
    | 'audioOffsetSeconds'
    | 'audioUnwrappedOffsetSeconds'
    | 'audioLoopStartSeconds'
    | 'audioLoopPassEntrySeconds'
    | 'audioLoopPassOriginBeat'
>;

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
              /** Omitted for the owner's next default name for the kind ("MIDI 3"), resolved once before the action is recorded. */
              name?: string;
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
    | {
          /** Inverse of clip duplication. Removes the exact duplicate created by
           *  `duplicateClip` / `duplicateClipToNextBar` without applying the user's
           *  current ripple-delete mode. */
          type: 'discardDuplicatedClip';
          payload: {
              clipId: string;
              generatedMidiStateGuard?: GeneratedMidiStateGuard;
              /**
               * The take lanes this discard retired, written by its `execute()`
               * before `removeClip` runs. The paired redo re-creates the same clip
               * id, so the entry's own inverse is what carries the capture — across
               * the session mirror too, where a shared array would not survive.
               * Optional so entries persisted before takes joined this payload still
               * decode; absent means the discard recorded nothing.
               */
              retiredTakeLanes?: readonly RetiredTakeLaneSnapshot[];
          };
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
    | { type: 'soloTrack'; payload: { trackId: string; soloed: boolean; expectedSoloed?: boolean } }
    | {
          /** Guarded self-inverse of comp take selection. Fresh intent carries a
           *  non-null `takeId`; replay also binds the captured lane owner and may
           *  use `null` to restore an empty selection. `expectedSelectedTakeId`
           *  optimistic-locks the lane's current selection: `undefined` asserts
           *  nothing, `null` asserts no take is selected. */
          type: 'selectTake';
          payload: {
              trackId: string;
              takeId: string | null;
              expectedLaneId?: string;
              expectedSelectedTakeId?: string | null;
          };
      }
    | { type: 'replaceOriginalMidiTakeRow'; payload: OriginalMidiTakeRowReplacementPayload }
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
    | { type: 'removeClip'; payload: { clipId: string; /** Internal captured replay preference. */ ripple?: boolean } }
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
              /**
               * Shared holder for the take lanes the undo leg retires from the
               * right half, filled in place by `execute()` when it filters the
               * right clip out. The paired redo carries the same array, so the
               * redo can put back a take that landed on the right half after the
               * split. Optional so entries persisted before the field existed
               * still decode; absent means the undo records nothing and the redo
               * restores nothing.
               */
              retiredTakeLanes?: RetiredTakeLaneSnapshot[];
              retiredTakeSourceProof?: CommandSourceProof;
              /** Actual forward audio split publication; immutable through replay. */
              splitSourceProof?: CommandSourceProof;
              /**
               * Shared holder for the take/comp-region re-key the forward split
               * captured (#5048), filled in place by its `execute()`. The undo
               * leg restores the pre-split facets from it; the paired redo
               * re-applies them. Optional so entries persisted before the field
               * existed still decode; absent means neither leg re-keys lanes.
               */
              reKeyedTakeLanes?: TakeReKeyLaneTransitionSnapshot[];
          };
      }
    | {
          type: 'trimClipStart';
          payload: {
              clipId: string;
              newStartBeat: number;
              /**
               * The exact pre-action loop anchor the recorded inverse restores
               * (#5198): a value puts that anchor back and `null` restores "no
               * anchor", removing a key the action minted, so both replay
               * directions restore the pre-action state. Optional so entries
               * persisted before the field existed still decode; absent replays
               * the mint law they always did. AiRuntime-produced trims never
               * set it.
               */
              loopOriginBeat?: number | null;
              /**
               * The pre-action stored `midiOffsetBeats` a recorded inverse
               * restores verbatim (#5512). The trim's forward wrap derives its
               * loop length from the post-trim duration while the replay's wrap
               * derives from the post-restore duration, and on a
               * duration-derived loop (`loopLength` unset) those durations
               * differ, so the re-wrapping replay lands the stored rows a
               * trim-wrap distance from the figures the slip's own recorded
               * inverse then restores against. The capture keys the verbatim
               * restoration on this key's presence — zero included — the same
               * recorded-inverse law the slip's `rowLiftBeats` follows. Only
               * recorded inverses set it: a fresh dispatch never carries it,
               * and entries recorded before the field existed decode without it
               * and replay the re-wrapping law they always did.
               */
              midiOffsetBeats?: number;
              /** Owner-bound inverse/redo capture; never supplied by a fresh provider request. */
              midiRowCoordinates?: MidiRowCoordinateCapture;
          };
      }
    | { type: 'trimClipEnd'; payload: { clipId: string; newEndBeat: number } }
    | {
          /** Internal exact audio-head replay; never a public trim source override. */
          type: 'restoreAudioClipStartTrim';
          payload: {
              clipId: string;
              before: ClipStateSnapshot;
              after: ClipStateSnapshot;
              clock: TempoSourceClock;
              /** Complete source scope captured before trim; empty when the clip has no takes. */
              takeSourceTransitions: TakeReKeyLaneTransitionSnapshot[];
              direction: 'apply' | 'restore';
          };
      }
    | {
          /** Internal exact source slip replay; absent from public command discovery. */
          type: 'restoreAudioClipSlip';
          payload: {
              clipId: string;
              offset: number;
              before: { clip: ClipStateSnapshot; lanes: CompTakeLaneSnapshot[] };
              after: { clip: ClipStateSnapshot; lanes: CompTakeLaneSnapshot[] };
              clock: TempoSourceClock;
              direction: 'apply' | 'restore';
          };
      }
    | {
          type: 'slipClipContent';
          payload: {
              clipId: string;
              clipType: 'audio' | 'midi';
              offset: number;
              /**
               * The row shift a recorded inverse must apply to restore the rows
               * the forward slip's raising wrap lifted (#5198): the lift carried
               * negative, zero included — the replay keys verbatim restoration
               * on this key's presence, so a recorded inverse is never keyed
               * keyless. Only recorded inverses set it — a fresh dispatch is
               * keyless and keeps the forward wrap law, and entries recorded
               * before the field existed decode without it; the undo seams'
               * legacy normalizer re-keys those to the same verbatim
               * restoration (`rowLiftBeats: 0`).
               */
              rowLiftBeats?: number;
              /** Owner-bound inverse/redo capture; never supplied by a fresh provider request. */
              midiRowCoordinates?: MidiRowCoordinateCapture;
          };
      }
    | {
          /** Draw-tool clip creation; `ripple` shifts later clips on the track by the
           *  drawn length, exactly as the gesture's ripple insert did. */
          type: 'drawClip';
          payload: {
              /** Internal replay identity. AiRuntime payload validation rejects this field. */
              id?: string;
              trackId: string;
              startBeat: number;
              endBeat: number;
              name: string;
              type: 'audio' | 'midi';
              ripple: boolean;
          };
      }
    | {
          /** Inverse of `drawClip`. Removes the drawn clip and restores any
           *  ripple-shifted neighbors. Emitted only by the `drawClip` handler's
           *  `describe()` — not invoked directly. */
          type: 'discardDrawnClip';
          payload: {
              clipId: string;
              trackId: string;
              ripplePlan: ClipRippleInsertPlanSnapshot | null;
              /**
               * Shared holder for the take lanes this discard retires, filled in
               * place by its `execute()` before `removeClip` runs. The paired
               * `restoreDrawnClip` redo carries the same array, so the redo can put
               * back a take that landed on the drawn clip after the draw. Optional
               * so entries persisted before the field existed still decode; absent
               * means the discard records nothing and the redo restores nothing.
               */
              retiredTakeLanes?: RetiredTakeLaneSnapshot[];
          };
      }
    | {
          /** Redo of `drawClip`. Re-creates the drawn clip and re-applies the
           *  ripple plan captured at draw time — never re-plans against live
           *  state, so redo restores the forward placement whatever the current
           *  ripple preference is. Emitted only by the `drawClip` handler's
           *  `describe()` — not invoked directly. */
          type: 'restoreDrawnClip';
          payload: {
              clipId: string;
              trackId: string;
              startBeat: number;
              endBeat: number;
              name: string;
              type: 'audio' | 'midi';
              ripplePlan: ClipRippleInsertPlanSnapshot | null;
              /** The same shared holder `discardDrawnClip` fills; see there. */
              retiredTakeLanes?: RetiredTakeLaneSnapshot[];
          };
      }
    | {
          type: 'duplicateClipAt';
          payload: {
              clipId: string;
              destinationTrackId: string;
              startBeat: number;
              /** Internal replay identity. AiRuntime payload validation rejects this field. */
              targetClipId?: string;
          };
      }
    | {
          /** One multi-clip move gesture — plain and ripple commits alike. The
           *  handler computes each ripple plan between sequential writes, exactly
           *  as the callback loop did. */
          type: 'moveClips';
          payload: { moves: readonly ClipMoveTarget[]; ripple: boolean };
      }
    | {
          /** Inverse of `moveClips`. Restores every moved clip's placement and the
           *  pre-gesture positions of every ripple-shifted neighbor. Emitted only
           *  by the `moveClips` handler — not invoked directly. */
          type: 'restoreClipMoves';
          payload: { movedClips: readonly ClipMoveTarget[]; neighborShifts: readonly ClipShiftSnapshot[] };
      }
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
              /** Descriptor-backed native unit for model-authored parameter values. */
              valueUnit?: DeviceParameterValueUnit;
              expectedTrackId?: string;
              expectedDeviceType?: string;
              expectedDeviceIds?: readonly string[];
              expectedValue?: number;
              expectedValuePresent?: boolean;
              expectedTrackFrozen?: boolean;
              /** Internal replay flag: restore the parameter map to an absent property. */
              deleteParameter?: boolean;
              automationRecordingPolicy?: AutomationRecordingPolicy;
          };
      }
    | {
          type: 'setExternalPluginState';
          payload:
              | {
                    intent: 'capture';
                    deviceId: string;
                    stateChunk: string;
                    expectedInstanceId: string;
                    expectedStateChunk: string | null;
                }
              | { intent: 'replacement'; deviceId: string; stateChunk: string };
      }
    | { type: 'setDeviceState'; payload: { deviceId: string; state: DeviceStateChunkSnapshot } }
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
          /**
           * Exactly one level form is stated. The decibel forms are resolved by the
           * handler against the live value; the store keeps a linear amplitude
           * whichever form asked. Two forms at once is a contradiction rather than a
           * preference, and none at all leaves nothing to write, so both are refused
           * by the handler and by the AiRuntime payload validator.
           */
          payload: {
              trackId: string;
              busId: string;
              /** Stored linear amplitude. Exactly one of `level`, `levelDb`, `deltaDb`. */
              level?: number;
              /** Absolute send level in decibels. */
              levelDb?: number;
              /** Change relative to the send's live level, in decibels. */
              deltaDb?: number;
              /** New tap point; omitted keeps the send's current one. */
              preFader?: boolean;
              expectedLevel?: number;
              expectedPreFader?: boolean;
          };
      }
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
    | { type: 'setClipGainEnvelope'; payload: { clipId: string; envelope: ClipSatelliteGainEnvelopeSnapshot | null } }
    | { type: 'toggleClipGainEnvelope'; payload: { clipId: string; expectedEnabled?: boolean } }
    | {
          type: 'addGainEnvelopePoint';
          payload: { clipId: string; beatOffset: number; gainDb: number; pointId?: string };
      }
    | { type: 'removeGainEnvelopePoint'; payload: { clipId: string; pointId: string } }
    | { type: 'resetClipGainEnvelope'; payload: { clipId: string } }
    | {
          type: 'setTrackGain';
          /**
           * Exactly one level form is stated. The decibel forms are resolved by the
           * handler against the live value; the store keeps a linear amplitude
           * whichever form asked. Two forms at once is a contradiction rather than a
           * preference, and none at all leaves nothing to write, so both are refused
           * by the handler and by the AiRuntime payload validator.
           *
           * `expectedGain` stays required whichever form asked: every internal caller
           * measures before it writes, and a provider-sourced action is stamped with
           * the live gain during state-guard materialization.
           */
          payload: {
              trackId: string;
              /** Stored linear amplitude. Exactly one of `gain`, `gainDb`, `deltaDb`. */
              gain?: number;
              /** Absolute fader level in decibels. */
              gainDb?: number;
              /** Change relative to the track's live gain, in decibels. */
              deltaDb?: number;
              expectedGain: number;
              automationRecordingPolicy?: AutomationRecordingPolicy;
          };
      }
    | {
          type: 'setTrackPan';
          payload: {
              trackId: string;
              pan: number;
              expectedPan: number;
              automationRecordingPolicy?: AutomationRecordingPolicy;
          };
      }
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
              /** Fades the restore puts back; optional so undo entries captured
               *  before reverse mirrored them still decode. */
              fadeInBeats?: number;
              fadeOutBeats?: number;
              /** Offset the restore puts back; optional so older undo entries still decode. */
              audioOffsetBeats?: number;
              /** Modern exact optional alias capture. Absent retains the older numeric/omitted contract. */
              audioOffsetBeatsCapture?: { present: false } | { present: true; value: number };
              /** Loop anchor the restore puts back; optional so older undo entries still decode. */
              loopOriginBeat?: number;
              /** Canonical source clock the restore puts back exactly. Present only for a
               *  clip carrying `audioOffsetSeconds`; absent leaves the live fields untouched,
               *  so beat-only clips and older undo entries restore as before. */
              audioSource?: ClipAudioSourceSnapshot;
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
    | {
          type: 'setCompRegion';
          payload: {
              trackId: string;
              startBeat: number;
              endBeat: number;
              takeId: string;
              /** Internal identity and state guards captured before Command's first await. */
              laneId?: string;
              expected?: readonly CompSelectionSpanSnapshot[];
              replacement?: readonly CompSelectionSpanSnapshot[];
              audioSourcePromotions?: readonly CompAudioSourcePromotionSnapshot[];
              baseGapAudioSourceFieldPresence?: CompAudioSourceFieldPresenceSnapshot;
          };
      }
    | {
          type: 'removeCompRegion';
          payload: {
              trackId: string;
              startBeat: number;
              /** Owner-captured interval and source guards, never caller-authored snapshots. */
              laneId?: string;
              endBeat?: number;
              expected?: readonly CompSelectionSpanSnapshot[];
              replacement?: readonly CompSelectionSpanSnapshot[];
              audioSourcePromotions?: readonly CompAudioSourcePromotionSnapshot[];
              baseGapAudioSourceFieldPresence?: CompAudioSourceFieldPresenceSnapshot;
          };
      }
    | {
          /** Guarded interval replay emitted by a comp interval edit. */
          type: 'restoreCompRegionInterval';
          payload: {
              laneId: string;
              trackId: string;
              startBeat: number;
              endBeat: number;
              expected: readonly CompSelectionSpanSnapshot[];
              replacement: readonly CompSelectionSpanSnapshot[];
              audioSourcePromotions?: readonly CompAudioSourcePromotionSnapshot[];
              baseGapAudioSourceFieldPresence?: CompAudioSourceFieldPresenceSnapshot;
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
                  clipBAudioOffsetBeats?: number;
                  clipBMidiOffsetBeats?: number;
                  /**
                   * The loop anchor the captured clip B carried, so the undo
                   * of a stretched crossfade restores the pre-crossfade anchor
                   * the forward leg displaced (#5198). Absent on legacy
                   * entries, which decode and restore exactly as before: the
                   * live anchor is left untouched.
                   */
                  clipBLoopOriginBeat?: number;
                  /**
                   * Clip B's canonical source clock, present only when clip B
                   * carries `audioOffsetSeconds`. The restore puts it back
                   * whole; legacy entries without it leave the live clock
                   * untouched.
                   */
                  clipBAudioSource?: ClipAudioSourceSnapshot;
              };
              replacement: {
                  clipAEndBeat: number;
                  clipAFadeOutBeats: number;
                  clipBStartBeat: number;
                  clipBFadeInBeats: number;
                  clipBAudioOffsetBeats?: number;
                  clipBMidiOffsetBeats?: number;
                  clipBLoopOriginBeat?: number;
                  clipBAudioSource?: ClipAudioSourceSnapshot;
              };
          };
      }
    | {
          type: 'setClipGain';
          /**
           * Exactly one level form is stated. The decibel forms are resolved by the
           * handler against the live value; the store keeps a linear amplitude
           * whichever form asked. Two forms at once is a contradiction rather than a
           * preference, and none at all leaves nothing to write, so both are refused
           * by the handler and by the AiRuntime payload validator.
           */
          payload: {
              clipId: string;
              /** Stored linear amplitude. Exactly one of `gain`, `gainDb`, `deltaDb`. */
              gain?: number;
              /** Absolute clip level in decibels. */
              gainDb?: number;
              /** Change relative to the clip's live gain, in decibels. */
              deltaDb?: number;
              /** Application-owned replay guard. AiRuntime payload validation rejects this field. */
              expectedGain?: number;
          };
      }
    | { type: 'setClipColor'; payload: { clipId: string; color: string; expectedColor?: string } }
    | { type: 'lockClip'; payload: { clipId: string; locked: boolean; expectedLocked?: boolean } }
    | { type: 'consolidateSelection'; payload: { trackId: string; startBeat: number; endBeat: number } }
    | { type: 'bounceSelection'; payload: { trackId: string; startBeat: number; endBeat: number } }
    | { type: 'zoomTracksVertical'; payload: { delta: number } }
    | {
          type: 'setTrackOutput';
          payload: { trackId: string; outputId: string; expectedOutputId?: string };
      }
    | {
          type: 'addSend';
          /**
           * Exactly one level form is stated. The decibel forms are resolved by the
           * handler against the live value; the store keeps a linear amplitude
           * whichever form asked. Two forms at once is a contradiction rather than a
           * preference, and none at all leaves nothing to write, so both are refused
           * by the handler and by the AiRuntime payload validator.
           */
          payload: {
              trackId: string;
              busId: string;
              /** Stored linear amplitude. Exactly one of `level`, `levelDb`, `deltaDb`. */
              level?: number;
              /** Absolute send level in decibels. */
              levelDb?: number;
              /** Change relative to unity, in decibels: the send does not exist yet. */
              deltaDb?: number;
              preFader?: boolean;
              expectedAbsent?: true;
          };
      }
    | {
          type: 'removeSend';
          payload: { trackId: string; busId: string; expectedLevel?: number; expectedPreFader?: boolean };
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
    | { type: 'exportMidi'; payload: { clipId: string } }
    | { type: 'foldTrack'; payload: { trackId: string; folded: boolean } }
    | { type: 'groupTracks'; payload: { trackIds: string[]; name: string } }
    | { type: 'ungroupTracks'; payload: { groupId: string } }
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
    | { type: 'setClipLoop'; payload: { clipId: string; enabled: boolean } }
    | {
          /** Internal exact-state replay for optional clip loop metadata. */
          type: 'restoreClipLoop';
          payload: {
              clipId: string;
              expected: {
                  present: boolean;
                  enabled: boolean;
                  /**
                   * The loop anchor the captured clip carried (#5198). Absent
                   * on legacy entries, which decode and behave exactly as
                   * before. The compare-and-swap guard reads only present and
                   * enabled: the anchor is inert while the loop is off, and a
                   * legacy expected snapshot must not conflict with a live
                   * anchor a later edit minted. `null` rides on entries whose
                   * captured clip carried none.
                   */
                  loopOriginBeat?: number | null;
              };
              replacement: {
                  present: boolean;
                  enabled: boolean;
                  /**
                   * The anchor to put back: the inverse of a loop disable
                   * restores the pre-disable anchor instead of the enable
                   * branch's restamp (#5198). `null` records a captured clip
                   * that carried no anchor, so the inverse of an enable
                   * removes the key the enable minted instead of leaving it on
                   * a never-looped clip. Absent — legacy entries — replays the
                   * enable's restamp exactly as before.
                   */
                  loopOriginBeat?: number | null;
              };
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
    | { type: 'loadExternalPlugin'; payload: { pluginId: string; trackId?: string } }
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
    | { type: 'setVcaGain'; payload: { vcaGroupId: string; gain?: number; gainDb?: number; deltaDb?: number } }
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
      }
    | { type: 'detectTransients'; payload: { clipId: string; sensitivity?: number } }
    | {
          type: 'quantizeTransients';
          payload: {
              clipId: string;
              /** Grid step in beats. */
              gridSize: number;
              strength?: number;
              swing?: number;
              sensitivity?: number;
              minConfidence?: number;
              /** Absolute beat range the onsets must start in, half-open. */
              startBeat?: number;
              endBeat?: number;
              /** Internal deterministic replay metadata. AiRuntime rejects it. */
              plan?: TransientQuantizePlanSnapshot;
          };
      }
    | { type: 'enableWarping'; payload: { clipId: string } }
    | {
          /** One completed recording gesture: the recorded clip materialized in
           *  its track as ONE history entry. The provisional clip, take lane, and
           *  takes the recorder opens while capture runs carry no history of their
           *  own, and this action is dispatched only once the capture succeeds, so
           *  an incomplete capture commits nothing. Its inverse is
           *  `discardRecording` and its explicit redo is `restoreRecording`, so one
           *  undo removes the clip together with its take-lane membership and one
           *  redo puts the same clip identity, placement, and take membership
           *  back. */
          type: 'commitRecording';
          payload: {
              /** The recorded clip exactly as it must stand after the commit,
               *  including its final placement and its captured media reference. */
              clip: ClipStateSnapshot;
          };
      }
    | {
          /** Inverse of `commitRecording`. Removes the recorded clip and retires
           *  the takes naming it through the ordinary clip-retirement path,
           *  leaving pre-existing lanes and unrelated edits in place. */
          type: 'discardRecording';
          payload: { clipId: string };
      }
    | {
          /** Explicit redo of `commitRecording`. Carries the clip and the take-lane
           *  state the removal retired, so the replay restores the same clip
           *  identity, the same placement, and the same take membership without
           *  starting another capture. */
          type: 'restoreRecording';
          payload: {
              clip: ClipStateSnapshot;
              retiredTakeLanes: readonly RetiredTakeLaneSnapshot[];
              /** The clip's MIDI data, which the removal inverse deletes with
               *  the clip. Mirrors `restoreClip`'s snapshots so a recorded MIDI
               *  take comes back with its notes, controller, and pitch-bend
               *  state rather than empty. */
              midiNotesSnapshot: MidiNotesSnapshot | null;
              midiCcSnapshot: MidiCcSnapshot | null;
              midiPitchBendSnapshot: MidiPitchBendSnapshot | null;
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
