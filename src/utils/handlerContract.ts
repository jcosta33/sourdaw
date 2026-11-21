/**
 * Neutral cross-module handler contract. Houses the open `AppActionRegistry`, the
 * `AppAction` discriminated union derived from it, and the `ActionHandler` /
 * `HandlerDescribeResult` / `ExecuteOptions` types that `createHandler` and every
 * `get<Module>Handlers` factory build against. Lives in `src/utils/` (not a domain
 * module) so handler code across modules depends on this neutral surface rather than
 * on a type-only entry point in `Command/useCases`. It imports no module: each owning
 * module declares its action payloads and the snapshot shapes they carry in its own
 * `events/` folder and adds them to the registry by augmentation.
 */

import { type AgentRenderReceipt, type AgentWorkOwnerIdentity } from './agentRenderReceipt';

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
    /** The action replays a history entry (undo, redo or a replay refresh), so it restores a state rather than being a fresh user edit. */
    readonly replaysHistoryEntry?: true;
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
