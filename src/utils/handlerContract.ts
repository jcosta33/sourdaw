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
export type DrumPreviewRecipe = 'ghost-note-pocket' | 'half-time-space' | 'syncopated-hats';

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

/**
 * Open registry of app-action variants. Each owning module adds a key from its `events/`
 * folder.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-empty-object-type -- declaration-merging target: a type alias cannot merge, and owners add every key by augmentation
export interface AppActionRegistry {}

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
