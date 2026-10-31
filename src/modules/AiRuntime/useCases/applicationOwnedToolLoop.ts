import {
    getAgentBuiltinDeviceFactoryManifest,
    getMixRecipeCatalog,
    getPlatformPlugins,
} from '#/modules/Arrangement/useCases';
import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';
import { getAgentBuiltinDeviceRuntimeManifest } from '#/modules/AudioEngine/useCases';
import {
    getExecutableAppActionIntentCatalogUnicodeLength,
    isExecutableAppActionType,
    MAX_EXECUTABLE_APP_ACTION_INTENT_CATALOG_INTENT_LENGTH,
} from '#/modules/Command/useCases';
import { getAgentDeviceFactoryManifest } from '#/modules/PluginHost/useCases';
import {
    parseAgentDiscoveryInput,
    parseSemanticProjectQueryInput,
    queryAgentDiscovery,
    querySemanticProject,
} from '#/modules/Project/useCases';
import { canonicalJson, digest } from '#/utils/canonicalDigest';

import { APPLICATION_OWNED_CAPABILITY_OPERATIONS } from '../models/AgentCapabilityOperations';
import { type AgentPlanProposal } from '../models/AgentRun';
import {
    ANALYSIS_DETECT_TRANSIENTS_TOOL_NAME,
    ANALYSIS_MEASURE_TOOL_NAME,
    AGENT_CATALOG_CATEGORIES,
    type AgentCatalogCategory,
} from '../models/AgentToolCatalogNames';
import { type AnswerOnsets } from '../models/AnswerEvidence';
import { ANSWER_INTERPRETATION_TOOL_NAME } from '../models/AnswerInterpretation';
import { type PlanningAnswer } from '../models/AnswerRespond';
import {
    APPLICATION_TOOL_RECEIPT_MAX_BYTES,
    type ApplicationToolReceipt,
    type TerminalMeasurementSettlement,
} from '../models/ApplicationOwnedTool';
import { type CommandBatchDecline } from '../models/CommandBatchDecline';
import { DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT } from '../models/DeviceManifestPageLimits';
import {
    type HostedProviderTurn,
    type HostedTurnCall,
    type HostedTurnHistory,
    type HostedTurnRecord,
} from '../models/HostedTurnHistory';
import { MAX_LLM_ACTIONS_PER_BATCH } from '../models/LlmActionLimits';
import { type MeasuredPreview } from '../models/MeasuredPreview';
import { type MetricRecipeSource } from '../models/MetricGoalAdmission';
import {
    type AdoptedRecipe,
    type RetainedCommand,
    type RetainedCommandSet,
    type RetainedCompilation,
} from '../models/RetainedCompilation';
import { SEMANTIC_COMMAND_LIST_MAX_ITEMS } from '../models/SemanticCommandList';
import { PROPOSAL_REFINES_MAX_LENGTH } from '../models/ThreadContext';
import { type ToolSchema } from '../models/ToolDefinitions';
import {
    AUTO_TOOL_CHOICE,
    type HostedToolChoiceDirective,
} from '../repositories/cloudLlm/cloudInference/hostedToolPlan';
import {
    admitTurnReadReceipts,
    boundReceipt,
    byteLength,
    failureReceipt,
    serializeReceiptContext,
    serializeRemainingBudgetNote,
} from '../services/applicationToolReceiptBudget';
import { extractAgentPlanProposal, normalizeAgentPlanProposal } from '../transformers/normalizeAgentPlanProposal';
import { parseAnswerRespond } from '../transformers/parseAnswerRespond';
import { parseCommandBatchDecline } from '../transformers/parseCommandBatchDecline';
import { type ToolCallResult } from '../transformers/toolCallParser';

import {
    AGENT_CAPABILITIES_TOOL_NAME,
    AGENT_CATALOG_CURSOR_MAX_LENGTH,
    AGENT_CATALOG_CURSOR_PATTERN,
    AGENT_CATALOG_DISCOVERY_TOOL_NAME,
    AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
    AGENT_DEVICE_MANIFEST_TOOL_NAME,
    ANSWER_RESPOND_TOOL_NAME,
    COMMAND_BATCH_DECLINE_TOOL_NAME,
    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
    COMMAND_HISTORY_TOOL_NAME,
    getAgentToolCatalogSchemas,
    PROJECT_DISCOVERY_TOOL_NAME,
    PROJECT_QUERY_TOOL_NAME,
    PROJECT_RESOLVE_TOOL_NAME,
    RECIPE_DISCOVERY_TOOL_NAME,
    type RECIPE_EXPANSION_TOOL_NAME,
    type TRANSFORM_COMPILE_TOOL_NAME,
} from './agentToolCatalog';
import { type AnalysisMeasureRead, type AnswerRequestAuthority } from './answerContractTypes';
import {
    composeMeasuredAnswer,
    type AdmittedAnswerRead,
    type AdmittedAnswerIntake,
    type AnswerReadSource,
} from './composeMeasuredAnswer';
import { DEFERRED_AGENT_CAPABILITIES } from './deferredAgentCapabilities';
import { discoverMixRecipes } from './discoverMixRecipes';
import { type executeRecipeExpansion } from './executeRecipeExpansion';
import { type executeTransformCompile } from './executeTransformCompile';
import { formatReceiptContext } from './formatReceiptContext';
import { getAgentToolCatalogEntries } from './getAgentToolCatalogEntries';
import { parseRecipeDiscoveryInput } from './parseRecipeDiscoveryInput';
import { projectAnswerProviderReceipt } from './projectAnswerProviderReceipt';
import {
    WHOLE_REQUEST_PREPARATION_TOOL_NAMES,
    type WholeRequestIntakePhase,
} from './projectPlanningProviderToolSchemas';

export const APPLICATION_OWNED_TOOL_LOOP_LIMITS = {
    maxTurns: 4,
    maxCallsPerTurn: 4,
    maxTotalCalls: 8,
    maxReceiptBytesPerCall: APPLICATION_TOOL_RECEIPT_MAX_BYTES,
    maxReceiptBytesPerTurn: 32_768,
    maxTotalReceiptBytes: 65_536,
} as const;
/** One extra turn so query, search, discovery, interpretation and proposal all fit in one run. */
const CREATIVE_TURN_ALLOWANCE = 1;
const MAX_CALL_ID_LENGTH = 256;
/** What a provider's own call identifier may hold, across the dialects that return one. */
const PROVIDER_CALL_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
/**
 * What a synthesised identifier may hold: the narrowest hosted pattern, Anthropic's
 * `tool_use.id`. A call the loop names is replayed under that name on every wire, so a
 * character one dialect refuses would strand the turn that carries it.
 */
const SYNTHESISED_CALL_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_FILTER_STRING_LENGTH = 256;
const CATALOG_CURSOR_PATTERN = new RegExp(AGENT_CATALOG_CURSOR_PATTERN, 'u');

type QueryInput = Parameters<typeof querySemanticProject>[0];
type DiscoveryInput = Parameters<typeof queryAgentDiscovery>[0];
type DiscoveryVerdict = Exclude<ReturnType<typeof queryAgentDiscovery>, { status: 'receipt' }>;
type ParsedDiscovery = { status: 'valid'; input: DiscoveryInput } | { status: 'invalid'; reason: string };
type ApplicationToolPlanningOutcome =
    | {
          status: 'complete';
          toolCalls: ToolCallResult[];
          proposal?: AgentPlanProposal | null;
          /** The provider's own record of this turn, kept so a later turn can replay it natively. */
          providerTurn?: HostedProviderTurn;
      }
    | { status: 'rejected'; reason: string };

export type { ApplicationToolReceipt } from '../models/ApplicationOwnedTool';

export type ApplicationOwnedToolLoopInterpretationOutcome = 'none' | 'admitted' | 'clarified';

type TransformCompileResult = ReturnType<typeof executeTransformCompile>;
type RecipeExpansionResult = ReturnType<typeof executeRecipeExpansion>;

export type ApplicationOwnedToolLoopOutcome =
    | {
          status: 'complete';
          toolCalls: ToolCallResult[];
          /** The parsed decline when the run refused, so no caller parses the arguments again. */
          decline: CommandBatchDecline | null;
          /** The answer, its evidence resolved against this run's receipts, when the run answered. */
          answer: PlanningAnswer | null;
          /** The intents this run looked up in the command index, in the order it looked them up. */
          searchedIntents: string[];
          proposal: AgentPlanProposal | null;
          receipts: ApplicationToolReceipt[];
          terminalMeasurementSettlement?: string;
          turns: number;
          /** Whether this run's control phase admitted an interpretation, asked to clarify, or never ran. */
          interpretation: ApplicationOwnedToolLoopInterpretationOutcome;
          /** Every successful transform compilation and recipe expansion, for the proposal to adopt by call id. */
          retainedCompilations: readonly RetainedCompilation[];
      }
    | {
          status: 'rejected';
          reason: string;
          receipts: ApplicationToolReceipt[];
          turns: number;
      };

export class ApplicationOwnedToolLoopRequestError extends Error {
    readonly receipts: readonly ApplicationToolReceipt[];
    readonly turns: number;
    readonly originalError: unknown;

    constructor(error: unknown, receipts: readonly ApplicationToolReceipt[], turns: number) {
        super(error instanceof Error ? error.message : String(error));
        this.name = error instanceof Error ? error.name : 'ApplicationOwnedToolLoopRequestError';
        this.receipts = structuredClone(receipts);
        this.turns = turns;
        this.originalError = error;
    }
}

type ToolLoopLimits = Partial<Record<keyof typeof APPLICATION_OWNED_TOOL_LOOP_LIMITS, number>>;

export type ApplicationOwnedToolLoopInterpretationAdmission =
    | {
          status: 'admitted';
          receipt: { data: unknown; summary: string };
          providerProjection?: { kind: 'metric-intent'; catalogId: string };
      }
    | { status: 'clarify'; reason: string }
    | { status: 'rejected'; reason: string };

export type DeclineAdmission = { status: 'admitted' } | { status: 'refused'; reason: string };

type MeasurementOpportunity = {
    authorityId: string;
    callId: string;
    turn: number;
    revision: string;
    required: boolean;
    available: boolean;
};

type MeasurementIntake = MeasurementOpportunity & { toolName: string };

type HeldTerminal = {
    calls: IdentifiedToolCall[];
    proposal: AgentPlanProposal | null;
    turn: number;
    opportunity: MeasurementOpportunity;
};

type MeasurementAttempt = {
    loopId: string;
    callId: string;
    toolName: string;
    turn: number;
    revision: string | undefined;
};

type RunApplicationOwnedToolLoopInput = {
    loopId: string;
    requireWholeRequestIntake?: true;
    /** Current app-owned intake identity and availability; never a metric-proof assertion. */
    readMeasurementOpportunity?: () => MeasurementOpportunity | null;
    requestTurn: (input: {
        turn: number;
        wholeRequestIntake?: WholeRequestIntakePhase;
        receiptContext: string | null;
        /** Every earlier turn a hosted provider reported, ascending, for callers that replay them natively. */
        history: HostedTurnHistory;
        /** Set only after this run admitted the exact analysis catalog discovery receipt. */
        transientOnsetsDiscovered?: true;
        /** `receiptContext`'s header and what the run still allows, without the receipt JSON. */
        budgetNote: string;
        answerOnly?: true;
        answerIntakeOnly?: true;
        remaining: {
            turns: number;
            calls: number;
            receiptBytes: number;
        };
        /** Required terminal set on the final turn, or a caller-bound single measurement opportunity. */
        directive: HostedToolChoiceDirective;
    }) => Promise<ApplicationToolPlanningOutcome>;
    terminalToolNames: ReadonlySet<string>;
    signal?: AbortSignal;
    limits?: ToolLoopLimits;
    /** A caller whose local message carries receipts as text must admit that whole carrier. */
    textReceiptCharacterBudget?: number;
    /**
     * The application-owned control phase. The loop learns only whether a call was admitted; the
     * record it mints stays in the caller's closure, so no provider-visible turn can restate it.
     */
    interpretation?: {
        toolName: string;
        workflowToolName?: string;
        admit: (
            call: ToolCallResult,
            identity: { callId: string; turn: number }
        ) => ApplicationOwnedToolLoopInterpretationAdmission;
    };
    /**
     * The application's rule for which declines it admits. A refused decline is not the run's
     * outcome: the loop answers it with a retryable receipt carrying the reason and gives the
     * planner its next turn, so the refusal spends the turns the run already has and no more.
     */
    answerInterpretation?: {
        jointToolName?: string;
        admit: (
            call: ToolCallResult
        ) =>
            | { status: 'admitted'; authority: AnswerRequestAuthority }
            | { status: 'clarify' | 'rejected'; reason: string };
    };
    declineAdmission?: (decline: CommandBatchDecline) => DeclineAdmission;
    /**
     * The measurement read. It renders the project offline, so the caller binds it to the run's
     * revision and the loop executes at most one call to it per turn. Without it the tool stays
     * unavailable to this run. A preview measurement also returns the commands it measured, which
     * the loop retains for adoption only when `revision` names the revision they were compiled at.
     * `companionToolNames` are further tools `execute` answers that render the project the same
     * way, so they share the one-measurement-per-turn limit with `toolName`.
     */
    measurement?: {
        toolName: string;
        companionToolNames?: readonly string[];
        revision?: string;
        execute: (call: ToolCallResult, context: MeasurementCallContext) => Promise<AnalysisMeasureRead>;
    };
    /** Local source analysis; unlike measurement it never renders or retains commands. */
    transientOnsetRead?: {
        readAnswerSource?: (callId: string) => AnswerOnsets | undefined;
        execute: (input: { call: ToolCallResult; callId: string; turn: number }) => Promise<ApplicationToolReceipt>;
    };
    transform?: {
        toolName: typeof TRANSFORM_COMPILE_TOOL_NAME;
        revision: string;
        execute: (call: ToolCallResult, context: MeasurementCallContext) => TransformCompileResult;
    };
    /**
     * Recipe expansion, bound to the same captured project read model and revision as the transform
     * compiler. Without a revision the tool stays unavailable, because an expansion could never be
     * adopted against a project it was not read from.
     */
    recipe?: {
        toolName: typeof RECIPE_EXPANSION_TOOL_NAME;
        revision: string;
        execute: (call: ToolCallResult, context: RecipeExpansionCallContext) => RecipeExpansionResult;
    };
};

type MeasurementCallContext = {
    callId: string;
    turn: number;
    loopId: string;
    signal?: AbortSignal;
    retainedCompilations?: readonly RetainedCompilation[];
};

/** Every tool name the measurement read answers: its own and its companions'. */
function getMeasurementToolNames(measurement: RunApplicationOwnedToolLoopInput['measurement']): readonly string[] {
    return measurement === undefined ? [] : [measurement.toolName, ...(measurement.companionToolNames ?? [])];
}

/** `ordinal` numbers this run's expansions from 1, so the batch-local names two of them mint never collide. */
type RecipeExpansionCallContext = { callId: string; turn: number; ordinal: number };

type ParsedQuery = { status: 'valid'; input: QueryInput } | { status: 'invalid'; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The loop's own words for the part of an input the owner's parser refused. */
const STRICT_CONTRACT_PART: Readonly<Record<'arguments' | 'filters' | 'page' | 'revision', string>> = {
    arguments: 'arguments do not match',
    filters: 'filters do not match',
    page: 'page does not match',
    revision: 'revision does not match',
};

/**
 * The strict argument contract for one query call.
 *
 * The contract belongs to the owner that answers the call, so this reads the
 * owner's published parser rather than keeping a second copy of the key set and
 * the bounds. Only the wording of a refusal is the loop's own, because a
 * receipt names the tool the provider called.
 */
function parseProjectQueryArguments(argumentsValue: Record<string, unknown>): ParsedQuery {
    const parsed = parseSemanticProjectQueryInput(argumentsValue);
    if (parsed.status === 'invalid') {
        return {
            status: 'invalid',
            reason: `project.query ${STRICT_CONTRACT_PART[parsed.reason]} the strict query contract`,
        };
    }
    return { status: 'valid', input: parsed.input };
}

/**
 * The strict argument contract for one discovery call.
 *
 * A domain outside the published set stays a well-formed request: the owner
 * answers it as an unsupported domain, which is a different fact from arguments
 * the contract cannot read at all.
 */
function parseProjectDiscoveryArguments(argumentsValue: Record<string, unknown>): ParsedDiscovery {
    const parsed = parseAgentDiscoveryInput(argumentsValue);
    if (parsed.status === 'invalid') {
        return {
            status: 'invalid',
            reason: `project.discover ${STRICT_CONTRACT_PART[parsed.reason]} the strict discovery contract`,
        };
    }
    return { status: 'valid', input: parsed.input };
}

function executeSemanticProjectQuery(
    input: QueryInput,
    toolName: string,
    callId: string,
    turn: number,
    answerSources?: Map<string, AnswerReadSource>
): ApplicationToolReceipt {
    try {
        const receipt = querySemanticProject(input);
        answerSources?.set(callId, {
            kind: 'query-page',
            value: { queryType: receipt.queryType, itemCount: receipt.items.length, total: receipt.page.total },
        });
        return {
            schema: 'sourdaw.application-tool-receipt',
            schemaVersion: 1,
            callId,
            toolName,
            turn,
            status: 'success',
            revision: receipt.revisionToken,
            data: receipt,
            summary: `${receipt.queryType}: ${String(receipt.items.length)} of ${String(receipt.page.total)} item(s)`,
            warnings: [...receipt.warnings],
            error: null,
        };
    } catch {
        return failureReceipt({
            callId,
            turn,
            code: 'tool-execution-failed',
            safeMessage: 'Project query failed inside the application authority.',
            retryable: true,
        });
    }
}

function executeProjectQuery(
    call: ToolCallResult,
    callId: string,
    turn: number,
    answerSources?: Map<string, AnswerReadSource>
): ApplicationToolReceipt {
    const parsed = parseProjectQueryArguments(call.arguments);
    if (parsed.status === 'invalid') {
        return failureReceipt({
            callId,
            turn,
            code: 'invalid-tool-arguments',
            safeMessage: parsed.reason,
            retryable: true,
        });
    }
    return executeSemanticProjectQuery(parsed.input, PROJECT_QUERY_TOOL_NAME, callId, turn, answerSources);
}

/**
 * An owner's `unavailable` or `unsupported` verdict as a receipt.
 *
 * The verdict is the owner's answer rather than a failure of the call, so it is
 * carried verbatim and marked unretryable: repeating the same call cannot turn
 * a domain nobody publishes, or a catalog nothing has indexed, into a page.
 */
function discoveryVerdictReceipt(verdict: DiscoveryVerdict, callId: string, turn: number): ApplicationToolReceipt {
    const safeMessage = `${PROJECT_DISCOVERY_TOOL_NAME} ${verdict.domain}: ${verdict.status} (${verdict.reason})`;
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId,
        toolName: PROJECT_DISCOVERY_TOOL_NAME,
        turn,
        status: 'failure',
        revision: null,
        data: { status: verdict.status, domain: verdict.domain, reason: verdict.reason },
        summary: safeMessage,
        warnings: [],
        error: {
            code: verdict.status === 'unavailable' ? 'unavailable-tool' : 'invalid-tool-arguments',
            safeMessage,
            retryable: false,
        },
    };
}

function executeProjectDiscovery(call: ToolCallResult, callId: string, turn: number): ApplicationToolReceipt {
    const parsed = parseProjectDiscoveryArguments(call.arguments);
    if (parsed.status === 'invalid') {
        return failureReceipt({
            callId,
            toolName: PROJECT_DISCOVERY_TOOL_NAME,
            turn,
            code: 'invalid-tool-arguments',
            safeMessage: parsed.reason,
            retryable: true,
        });
    }
    try {
        const result = queryAgentDiscovery(parsed.input);
        if (result.status !== 'receipt') {
            return discoveryVerdictReceipt(result, callId, turn);
        }
        const receipt = result.receipt;
        return {
            schema: 'sourdaw.application-tool-receipt',
            schemaVersion: 1,
            callId,
            toolName: PROJECT_DISCOVERY_TOOL_NAME,
            turn,
            status: 'success',
            revision: receipt.revisionToken,
            data: receipt,
            summary: `${receipt.domain}: ${String(receipt.items.length)} of ${String(receipt.page.total)} item(s)`,
            warnings: [...receipt.warnings],
            error: null,
        };
    } catch {
        return failureReceipt({
            callId,
            toolName: PROJECT_DISCOVERY_TOOL_NAME,
            turn,
            code: 'tool-execution-failed',
            safeMessage: 'Project discovery failed inside the application authority.',
            retryable: true,
        });
    }
}

function executeProjectResolve(call: ToolCallResult, callId: string, turn: number): ApplicationToolReceipt {
    if (
        Object.keys(call.arguments).length !== 1 ||
        typeof call.arguments.stableId !== 'string' ||
        call.arguments.stableId.length === 0 ||
        call.arguments.stableId.length > MAX_FILTER_STRING_LENGTH
    ) {
        return failureReceipt({
            callId,
            toolName: PROJECT_RESOLVE_TOOL_NAME,
            turn,
            code: 'invalid-tool-arguments',
            safeMessage: 'project.resolve arguments do not match the strict resolve contract',
            retryable: true,
        });
    }
    return executeSemanticProjectQuery(
        { type: 'object', filters: { stableId: call.arguments.stableId } },
        PROJECT_RESOLVE_TOOL_NAME,
        callId,
        turn
    );
}

function executeCommandHistory(call: ToolCallResult, callId: string, turn: number): ApplicationToolReceipt {
    const parsed = parseProjectQueryArguments({ type: 'history', ...call.arguments });
    if (parsed.status === 'invalid') {
        return failureReceipt({
            callId,
            toolName: COMMAND_HISTORY_TOOL_NAME,
            turn,
            code: 'invalid-tool-arguments',
            safeMessage: 'command.history arguments do not match the strict history contract',
            retryable: true,
        });
    }
    return executeSemanticProjectQuery(parsed.input, COMMAND_HISTORY_TOOL_NAME, callId, turn);
}

function executeCapabilities(call: ToolCallResult, callId: string, turn: number): ApplicationToolReceipt {
    if (Object.keys(call.arguments).length > 0) {
        return failureReceipt({
            callId,
            toolName: AGENT_CAPABILITIES_TOOL_NAME,
            turn,
            code: 'invalid-tool-arguments',
            safeMessage: 'agent.capabilities accepts no arguments',
            retryable: true,
        });
    }
    const operations = [...APPLICATION_OWNED_CAPABILITY_OPERATIONS, ...DEFERRED_AGENT_CAPABILITIES];
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId,
        toolName: AGENT_CAPABILITIES_TOOL_NAME,
        turn,
        status: 'success',
        revision: null,
        data: {
            schema: 'sourdaw.agent-capabilities',
            schemaVersion: 1,
            operations,
        },
        summary: `${String(operations.length)} application-owned capability contract(s)`,
        warnings: [
            'Command preview, approval, and commit remain application-managed lifecycle steps.',
            'Deferred capabilities are reported for planning only; calling one is refused before any application work.',
        ],
        error: null,
    };
}

const DEVICE_MANIFEST_EXTERNAL_PLUGIN_WARNING =
    'External plugin metadata can be inferred; opaque plugin state is not exposed or patched.';
const DEVICE_MANIFEST_PAGE_TRUNCATED_WARNING =
    'Manifest page is truncated; continue with the same type, version and cursor.';

/** One built-in or scanned-external factory entry, merged the same way for a full or a paged read. */
function buildDeviceManifestEntries(types: readonly string[]) {
    const external = getAgentDeviceFactoryManifest(types);
    const descriptors = getAgentBuiltinDeviceFactoryManifest(types);
    const runtimeByType = new Map(
        getAgentBuiltinDeviceRuntimeManifest(descriptors.map((descriptor) => descriptor.type)).map((runtime) => [
            runtime.type,
            runtime,
        ])
    );
    const builtins = descriptors.map((descriptor) => {
        const runtime = runtimeByType.get(descriptor.type);
        const runtimeVersion = runtime?.runtimeVersion ?? 'runtime-v1:unavailable';
        const compositeVersion = `builtin-factory-v2:${descriptor.descriptorVersion}:${descriptor.characterVersion}:${descriptor.presetVersion}:${runtimeVersion}`;
        return {
            ...descriptor,
            capabilities: {
                domain: descriptor.capabilities,
                runtime: runtime?.capabilities ?? {
                    availability: 'unavailable' as const,
                    reason: 'No exact AudioEngine factory claims this descriptor type in the current runtime.',
                },
            },
            version: compositeVersion,
            versions: {
                descriptor: descriptor.descriptorVersion,
                character: descriptor.characterVersion,
                preset: descriptor.presetVersion,
                runtime: runtimeVersion,
                composite: compositeVersion,
            },
            runtime: runtime
                ? { live: runtime.live, offline: runtime.offline }
                : {
                      availability: 'unavailable' as const,
                      reason: 'No exact AudioEngine factory claims this descriptor type in the current runtime.',
                  },
        };
    });
    return [...builtins, ...external.devices];
}

type DeviceManifestPageArguments = { cursor?: string; index?: true; limit?: number };

/** The strict `page` argument contract for one `device.factory-manifest.read` call. */
function parseDeviceManifestPageArgument(
    pageValue: unknown
): { status: 'absent' } | { status: 'valid'; page: DeviceManifestPageArguments } | { status: 'invalid' } {
    if (pageValue === undefined) {
        return { status: 'absent' };
    }
    if (
        !isRecord(pageValue) ||
        Object.keys(pageValue).some((key) => key !== 'cursor' && key !== 'index' && key !== 'limit') ||
        (pageValue.cursor !== undefined &&
            (typeof pageValue.cursor !== 'string' ||
                pageValue.cursor.length === 0 ||
                pageValue.cursor.length > AGENT_CATALOG_CURSOR_MAX_LENGTH ||
                !CATALOG_CURSOR_PATTERN.test(pageValue.cursor))) ||
        (pageValue.limit !== undefined &&
            (typeof pageValue.limit !== 'number' ||
                !Number.isInteger(pageValue.limit) ||
                pageValue.limit < 1 ||
                pageValue.limit > DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT)) ||
        (pageValue.index !== undefined && pageValue.index !== true)
    ) {
        return { status: 'invalid' };
    }
    // The compact index is its own mode: it never combines with a cursor window.
    if (pageValue.index === true && (pageValue.cursor !== undefined || pageValue.limit !== undefined)) {
        return { status: 'invalid' };
    }
    return {
        status: 'valid',
        page: {
            ...(typeof pageValue.cursor === 'string' ? { cursor: pageValue.cursor } : {}),
            ...(pageValue.index === true ? { index: true as const } : {}),
            ...(typeof pageValue.limit === 'number' ? { limit: pageValue.limit } : {}),
        },
    };
}

/** Binds a `parameters` page to the exact device type and version it was cut from. */
type DeviceManifestParameterCursor = { schemaVersion: 1; type: string; version: string; offset: number };

function encodeDeviceManifestParameterCursor(cursor: DeviceManifestParameterCursor): string {
    const bytes = new TextEncoder().encode(JSON.stringify(cursor));
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeDeviceManifestParameterCursor(cursor: string): DeviceManifestParameterCursor | null {
    try {
        const base64 = cursor.replaceAll('-', '+').replaceAll('_', '/');
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        const binary = atob(padded);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (
            typeof value !== 'object' ||
            value === null ||
            Array.isArray(value) ||
            Object.keys(value).length !== 4 ||
            !('schemaVersion' in value) ||
            !('type' in value) ||
            !('version' in value) ||
            !('offset' in value) ||
            value.schemaVersion !== 1 ||
            typeof value.type !== 'string' ||
            typeof value.version !== 'string' ||
            typeof value.offset !== 'number' ||
            !Number.isSafeInteger(value.offset) ||
            value.offset < 0
        ) {
            return null;
        }
        return { schemaVersion: 1, type: value.type, version: value.version, offset: value.offset };
    } catch {
        return null;
    }
}

function deviceManifestFailure(input: { callId: string; turn: number; safeMessage: string }): ApplicationToolReceipt {
    return failureReceipt({
        callId: input.callId,
        toolName: AGENT_DEVICE_MANIFEST_TOOL_NAME,
        turn: input.turn,
        code: 'invalid-tool-arguments',
        safeMessage: input.safeMessage,
        retryable: true,
    });
}

function deviceManifestSuccess(input: {
    callId: string;
    turn: number;
    data: unknown;
    summary: string;
    warnings: string[];
}): ApplicationToolReceipt {
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: input.callId,
        toolName: AGENT_DEVICE_MANIFEST_TOOL_NAME,
        turn: input.turn,
        status: 'success',
        revision: null,
        data: input.data,
        summary: input.summary,
        warnings: input.warnings,
        error: null,
    };
}

/**
 * Reads one type's compact parameter index: `{ id, name }` for every parameter
 * of the descriptor, in one receipt for every released builtin type. This is
 * how a planner discovers which parameters a large descriptor offers without
 * paging its full entries (#4797).
 */
function executeDeviceManifestParameterIndex(input: {
    type: string;
    callId: string;
    turn: number;
}): ApplicationToolReceipt {
    const entry = buildDeviceManifestEntries([input.type])[0];
    if (entry === undefined) {
        return deviceManifestSuccess({
            callId: input.callId,
            turn: input.turn,
            data: {
                schema: 'sourdaw.agent-device-factory-manifest',
                schemaVersion: 1,
                devices: [],
            },
            summary: `Index of 0 parameter(s) for ${input.type}`,
            warnings: [DEVICE_MANIFEST_EXTERNAL_PLUGIN_WARNING],
        });
    }
    const parameterIndex = entry.parameters.map((parameter) => ({ id: parameter.id, name: parameter.name }));
    return deviceManifestSuccess({
        callId: input.callId,
        turn: input.turn,
        data: {
            schema: 'sourdaw.agent-device-factory-manifest',
            schemaVersion: 1,
            devices: [
                {
                    type: entry.type,
                    name: entry.name,
                    version: entry.version,
                    parameterCount: parameterIndex.length,
                    parameterIndex,
                },
            ],
        },
        summary: `Index of ${String(parameterIndex.length)} parameter(s) for ${input.type}`,
        warnings: [DEVICE_MANIFEST_EXTERNAL_PLUGIN_WARNING],
    });
}

/**
 * Reads exactly the named parameters of one type, in descriptor order, with
 * their full bounds, legal sets and guidance. The compact index names the ids;
 * this call fetches only the parameters the planner needs in one run (#4797).
 */
function executeDeviceManifestParameterSelection(input: {
    type: string;
    parameterIds: readonly string[];
    callId: string;
    turn: number;
}): ApplicationToolReceipt {
    const entry = buildDeviceManifestEntries([input.type])[0];
    if (entry === undefined) {
        return deviceManifestSuccess({
            callId: input.callId,
            turn: input.turn,
            data: {
                schema: 'sourdaw.agent-device-factory-manifest',
                schemaVersion: 1,
                devices: [],
            },
            summary: `0 of 0 parameter(s) for ${input.type}`,
            warnings: [DEVICE_MANIFEST_EXTERNAL_PLUGIN_WARNING],
        });
    }
    const requestedIds = new Set(input.parameterIds);
    const selected = entry.parameters.filter((parameter) => requestedIds.has(parameter.id));
    // The ids arrive pre-deduplicated, so any shortfall names an id the
    // descriptor does not declare.
    if (selected.length !== input.parameterIds.length) {
        return deviceManifestFailure({
            callId: input.callId,
            turn: input.turn,
            safeMessage: 'device.factory-manifest.read parameterIds do not all name parameters of the requested type',
        });
    }
    return deviceManifestSuccess({
        callId: input.callId,
        turn: input.turn,
        data: {
            schema: 'sourdaw.agent-device-factory-manifest',
            schemaVersion: 1,
            devices: [{ ...entry, parameters: selected }],
        },
        summary: `${String(selected.length)} of ${String(entry.parameters.length)} parameter(s) for ${input.type}`,
        warnings: [DEVICE_MANIFEST_EXTERNAL_PLUGIN_WARNING],
    });
}

/**
 * Reads one type's `parameters` window. Only reachable once the caller has already resolved a
 * single requested type and a valid `page` argument, so the cursor's identity check has exactly
 * one live entry to bind against.
 */
function executeDeviceManifestPage(input: {
    type: string;
    page: DeviceManifestPageArguments;
    callId: string;
    turn: number;
}): ApplicationToolReceipt {
    const { type, page, callId, turn } = input;
    if (page.index === true) {
        return executeDeviceManifestParameterIndex({ type, callId, turn });
    }
    const entry = buildDeviceManifestEntries([type])[0];
    const limit = page.limit ?? DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT;
    if (entry === undefined) {
        return deviceManifestSuccess({
            callId,
            turn,
            data: {
                schema: 'sourdaw.agent-device-factory-manifest',
                schemaVersion: 1,
                devices: [],
                page: { limit, offset: 0, total: 0 },
                nextCursor: null,
                truncated: false,
            },
            summary: '0 device factory manifest(s)',
            warnings: [DEVICE_MANIFEST_EXTERNAL_PLUGIN_WARNING],
        });
    }
    const totalParameters = entry.parameters.length;
    let offset = 0;
    if (page.cursor !== undefined) {
        const decoded = decodeDeviceManifestParameterCursor(page.cursor);
        if (decoded === null || decoded.type !== type || decoded.version !== entry.version) {
            return deviceManifestFailure({
                callId,
                turn,
                safeMessage: 'device.factory-manifest.read cursor does not match the requested type or version',
            });
        }
        if (decoded.offset > totalParameters) {
            return deviceManifestFailure({
                callId,
                turn,
                safeMessage: 'device.factory-manifest.read cursor is outside the requested parameter page',
            });
        }
        offset = decoded.offset;
    }
    const windowParameters = entry.parameters.slice(offset, offset + limit);
    const nextOffset = offset + windowParameters.length;
    const truncated = nextOffset < totalParameters;
    return deviceManifestSuccess({
        callId,
        turn,
        data: {
            schema: 'sourdaw.agent-device-factory-manifest',
            schemaVersion: 1,
            devices: [{ ...entry, parameters: windowParameters }],
            page: { limit, offset, total: totalParameters },
            nextCursor: truncated
                ? encodeDeviceManifestParameterCursor({
                      schemaVersion: 1,
                      type,
                      version: entry.version,
                      offset: nextOffset,
                  })
                : null,
            truncated,
        },
        summary: `${String(windowParameters.length)} of ${String(totalParameters)} parameter(s) for ${type}`,
        warnings: truncated
            ? [DEVICE_MANIFEST_EXTERNAL_PLUGIN_WARNING, DEVICE_MANIFEST_PAGE_TRUNCATED_WARNING]
            : [DEVICE_MANIFEST_EXTERNAL_PLUGIN_WARNING],
    });
}

/**
 * The device catalogue a full context carries as `availableDeviceTypes`, as identity only. A delta
 * turn omits that list, so a call with no arguments is how the planner asks for it again; the
 * parameters of one type stay behind the typed, paged manifest read, which keeps this receipt far
 * under the per-call receipt budget however many devices are installed.
 */
function executeDeviceCatalogue(callId: string, turn: number): ApplicationToolReceipt {
    const availableDeviceTypes = getPlatformPlugins().map((plugin) => ({ id: plugin.id, name: plugin.name }));
    return deviceManifestSuccess({
        callId,
        turn,
        data: {
            schema: 'sourdaw.agent-device-catalogue',
            schemaVersion: 1,
            availableDeviceTypes,
        },
        summary: `${String(availableDeviceTypes.length)} available device type(s)`,
        warnings: [],
    });
}

function executeDeviceManifest(call: ToolCallResult, callId: string, turn: number): ApplicationToolReceipt {
    if (Object.keys(call.arguments).length === 0) {
        return executeDeviceCatalogue(callId, turn);
    }
    const typeValues = call.arguments.types;
    if (
        Object.keys(call.arguments).some((key) => key !== 'types' && key !== 'page' && key !== 'parameterIds') ||
        !Array.isArray(typeValues) ||
        typeValues.length === 0 ||
        typeValues.length > 8
    ) {
        return deviceManifestFailure({
            callId,
            turn,
            safeMessage: 'device.factory-manifest.read requires one bounded type set',
        });
    }
    const types: string[] = [];
    for (const type of typeValues) {
        if (typeof type !== 'string' || type.length === 0 || type.length > 256) {
            return deviceManifestFailure({
                callId,
                turn,
                safeMessage: 'device.factory-manifest.read requires one bounded type set',
            });
        }
        types.push(type);
    }
    const pageValue = call.arguments.page;
    if (pageValue !== undefined && types.length !== 1) {
        return deviceManifestFailure({
            callId,
            turn,
            safeMessage: 'device.factory-manifest.read page requires exactly one type',
        });
    }
    const parameterIdsValue = call.arguments.parameterIds;
    if (parameterIdsValue !== undefined && types.length !== 1) {
        return deviceManifestFailure({
            callId,
            turn,
            safeMessage: 'device.factory-manifest.read parameterIds require exactly one type',
        });
    }
    if (parameterIdsValue !== undefined && pageValue !== undefined) {
        return deviceManifestFailure({
            callId,
            turn,
            safeMessage: 'device.factory-manifest.read parameterIds cannot be combined with a page',
        });
    }
    if (parameterIdsValue !== undefined) {
        if (
            !Array.isArray(parameterIdsValue) ||
            parameterIdsValue.length === 0 ||
            parameterIdsValue.length > DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT
        ) {
            return deviceManifestFailure({
                callId,
                turn,
                safeMessage: 'device.factory-manifest.read parameterIds do not match the strict selection contract',
            });
        }
        const parameterIds: string[] = [];
        for (const parameterId of parameterIdsValue) {
            if (
                typeof parameterId !== 'string' ||
                parameterId.length === 0 ||
                parameterId.length > 256 ||
                parameterIds.includes(parameterId)
            ) {
                return deviceManifestFailure({
                    callId,
                    turn,
                    safeMessage: 'device.factory-manifest.read parameterIds do not match the strict selection contract',
                });
            }
            parameterIds.push(parameterId);
        }
        return executeDeviceManifestParameterSelection({
            type: types[0]!,
            parameterIds,
            callId,
            turn,
        });
    }
    const pageArgument = parseDeviceManifestPageArgument(pageValue);
    if (pageArgument.status === 'invalid') {
        return deviceManifestFailure({
            callId,
            turn,
            safeMessage: 'device.factory-manifest.read page does not match the strict page contract',
        });
    }
    if (pageArgument.status === 'valid') {
        return executeDeviceManifestPage({ type: types[0]!, page: pageArgument.page, callId, turn });
    }
    const manifest = {
        schema: 'sourdaw.agent-device-factory-manifest',
        schemaVersion: 1,
        devices: buildDeviceManifestEntries(types),
    };
    return deviceManifestSuccess({
        callId,
        turn,
        data: manifest,
        summary: `${String(manifest.devices.length)} device factory manifest(s)`,
        warnings: [DEVICE_MANIFEST_EXTERNAL_PLUGIN_WARNING],
    });
}

function isCatalogCategory(value: unknown): value is AgentCatalogCategory {
    return typeof value === 'string' && AGENT_CATALOG_CATEGORIES.some((category) => category === value);
}

function parseCatalogDiscoveryArguments(argumentsValue: Record<string, unknown>):
    | {
          status: 'valid';
          input: Parameters<typeof getAgentToolCatalogEntries>[0];
      }
    | { status: 'invalid'; reason: string } {
    if (
        Object.keys(argumentsValue).some(
            (key) => key !== 'category' && key !== 'intent' && key !== 'names' && key !== 'page'
        )
    ) {
        return {
            status: 'invalid',
            reason: 'agent.catalog.discover arguments do not match the strict catalog contract',
        };
    }
    const category = argumentsValue.category;
    if (!isCatalogCategory(category)) {
        return { status: 'invalid', reason: 'agent.catalog.discover category is unavailable' };
    }
    const namesValue = argumentsValue.names;
    if (!Array.isArray(namesValue) || namesValue.length === 0 || namesValue.length > 8) {
        return {
            status: 'invalid',
            reason: 'agent.catalog.discover names do not match the strict catalog contract',
        };
    }
    const names: string[] = [];
    if (Array.isArray(namesValue)) {
        for (const name of namesValue) {
            if (typeof name !== 'string' || name.length === 0 || name.length > 128 || names.includes(name)) {
                return {
                    status: 'invalid',
                    reason: 'agent.catalog.discover names do not match the strict catalog contract',
                };
            }
            names.push(name);
        }
    }
    if (argumentsValue.intent !== undefined) {
        return {
            status: 'invalid',
            reason: 'agent.catalog.discover intent is available only for command-index',
        };
    }
    const pageValue = argumentsValue.page;
    let page: { cursor?: string; limit?: number } | undefined;
    if (pageValue !== undefined) {
        if (
            !isRecord(pageValue) ||
            Object.keys(pageValue).some((key) => key !== 'cursor' && key !== 'limit') ||
            (pageValue.cursor !== undefined &&
                (typeof pageValue.cursor !== 'string' ||
                    pageValue.cursor.length === 0 ||
                    pageValue.cursor.length > AGENT_CATALOG_CURSOR_MAX_LENGTH ||
                    !CATALOG_CURSOR_PATTERN.test(pageValue.cursor))) ||
            (pageValue.limit !== undefined &&
                (typeof pageValue.limit !== 'number' ||
                    !Number.isInteger(pageValue.limit) ||
                    pageValue.limit < 1 ||
                    pageValue.limit > 8))
        ) {
            return {
                status: 'invalid',
                reason: 'agent.catalog.discover page does not match the strict catalog contract',
            };
        }
        page = {};
        if (typeof pageValue.cursor === 'string') {
            page.cursor = pageValue.cursor;
        }
        if (typeof pageValue.limit === 'number') {
            page.limit = pageValue.limit;
        }
    }
    return {
        status: 'valid',
        input: {
            category,
            names,
            ...(page === undefined ? {} : { page }),
        },
    };
}

function parseCommandIndexSearchArguments(argumentsValue: Record<string, unknown>):
    | {
          status: 'valid';
          input: Parameters<typeof getAgentToolCatalogEntries>[0];
      }
    | { status: 'invalid'; reason: string } {
    if (Object.keys(argumentsValue).some((key) => key !== 'intent' && key !== 'page')) {
        return {
            status: 'invalid',
            reason: 'agent.command-index.search arguments do not match the strict catalog contract',
        };
    }
    const intent = argumentsValue.intent;
    if (typeof intent !== 'string') {
        return {
            status: 'invalid',
            reason: 'agent.command-index.search intent does not match the strict catalog contract',
        };
    }
    const intentLength = getExecutableAppActionIntentCatalogUnicodeLength(intent);
    if (intentLength === 0 || intentLength > MAX_EXECUTABLE_APP_ACTION_INTENT_CATALOG_INTENT_LENGTH) {
        return {
            status: 'invalid',
            reason: 'agent.command-index.search intent does not match the strict catalog contract',
        };
    }
    const pageValue = argumentsValue.page;
    if (pageValue === undefined) {
        return { status: 'valid', input: { category: 'command-index', intent } };
    }
    if (
        !isRecord(pageValue) ||
        Object.keys(pageValue).some((key) => key !== 'cursor' && key !== 'limit') ||
        (pageValue.cursor !== undefined &&
            (typeof pageValue.cursor !== 'string' ||
                pageValue.cursor.length === 0 ||
                pageValue.cursor.length > AGENT_CATALOG_CURSOR_MAX_LENGTH ||
                !CATALOG_CURSOR_PATTERN.test(pageValue.cursor))) ||
        (pageValue.limit !== undefined &&
            (typeof pageValue.limit !== 'number' ||
                !Number.isInteger(pageValue.limit) ||
                pageValue.limit < 1 ||
                pageValue.limit > 8))
    ) {
        return {
            status: 'invalid',
            reason: 'agent.command-index.search page does not match the strict catalog contract',
        };
    }
    return {
        status: 'valid',
        input: {
            category: 'command-index',
            intent,
            page: {
                ...(typeof pageValue.cursor === 'string' ? { cursor: pageValue.cursor } : {}),
                ...(typeof pageValue.limit === 'number' ? { limit: pageValue.limit } : {}),
            },
        },
    };
}

function executeCatalogDiscovery(call: ToolCallResult, callId: string, turn: number): ApplicationToolReceipt {
    const parsed =
        call.name === AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME
            ? parseCommandIndexSearchArguments(call.arguments)
            : parseCatalogDiscoveryArguments(call.arguments);
    if (parsed.status === 'invalid') {
        return failureReceipt({
            callId,
            toolName: call.name,
            turn,
            code: 'invalid-tool-arguments',
            safeMessage: parsed.reason,
            retryable: true,
        });
    }
    try {
        const catalog = getAgentToolCatalogEntries(parsed.input);
        const isCommandIndex = catalog.category === 'command-index';
        return {
            schema: 'sourdaw.application-tool-receipt',
            schemaVersion: 1,
            callId,
            toolName: call.name,
            turn,
            status: 'success',
            revision: null,
            data: catalog,
            summary: isCommandIndex
                ? `command-index: ${String(catalog.items.length)} command(s)`
                : `${catalog.category}: ${String(catalog.items.length)} schema(s)`,
            warnings: catalog.truncated
                ? [
                      isCommandIndex
                          ? 'Command index page is truncated; continue with the same normalized search intent and cursor.'
                          : 'Catalog page is truncated; continue only this exact requested name set.',
                  ]
                : [],
            error: null,
        };
    } catch {
        return failureReceipt({
            callId,
            toolName: call.name,
            turn,
            code: 'invalid-tool-arguments',
            safeMessage: 'Catalog request was rejected by the application contract.',
            retryable: true,
        });
    }
}

function executeRecipeDiscovery(
    call: ToolCallResult,
    callId: string,
    turn: number,
    answerSources?: Map<string, AnswerReadSource>
): ApplicationToolReceipt {
    const parsed = parseRecipeDiscoveryInput(call.arguments, getMixRecipeCatalog().roles);
    if (parsed.status === 'invalid') {
        return failureReceipt({
            callId,
            toolName: RECIPE_DISCOVERY_TOOL_NAME,
            turn,
            code: 'invalid-tool-arguments',
            safeMessage: parsed.reason,
            retryable: true,
        });
    }
    try {
        const result = discoverMixRecipes(parsed.input);
        if (result.status === 'invalid-target') {
            return failureReceipt({
                callId,
                toolName: RECIPE_DISCOVERY_TOOL_NAME,
                turn,
                code: 'invalid-tool-arguments',
                safeMessage: `recipe.discover targetId "${result.targetId}" is not a track in the project.`,
                retryable: true,
            });
        }
        answerSources?.set(callId, { kind: 'recipe', value: result.data });
        return {
            schema: 'sourdaw.application-tool-receipt',
            schemaVersion: 1,
            callId,
            toolName: RECIPE_DISCOVERY_TOOL_NAME,
            turn,
            status: 'success',
            revision: null,
            data: result.data,
            summary: `${String(result.data.candidates.length)} of ${String(result.data.total)} recipe(s)`,
            warnings: [...result.warnings],
            error: null,
        };
    } catch {
        return failureReceipt({
            callId,
            toolName: RECIPE_DISCOVERY_TOOL_NAME,
            turn,
            code: 'tool-execution-failed',
            safeMessage: 'Recipe discovery failed inside the application authority.',
            retryable: true,
        });
    }
}

function executeSafeRead(
    call: ToolCallResult,
    callId: string,
    turn: number,
    answerSources?: Map<string, AnswerReadSource>
): ApplicationToolReceipt {
    switch (call.name) {
        case PROJECT_QUERY_TOOL_NAME:
            return executeProjectQuery(call, callId, turn, answerSources);
        case PROJECT_DISCOVERY_TOOL_NAME:
            return executeProjectDiscovery(call, callId, turn);
        case PROJECT_RESOLVE_TOOL_NAME:
            return executeProjectResolve(call, callId, turn);
        case AGENT_CAPABILITIES_TOOL_NAME:
            return executeCapabilities(call, callId, turn);
        case AGENT_DEVICE_MANIFEST_TOOL_NAME:
            return executeDeviceManifest(call, callId, turn);
        case AGENT_CATALOG_DISCOVERY_TOOL_NAME:
        case AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME:
            return executeCatalogDiscovery(call, callId, turn);
        case COMMAND_HISTORY_TOOL_NAME:
            return executeCommandHistory(call, callId, turn);
        case RECIPE_DISCOVERY_TOOL_NAME:
            return executeRecipeDiscovery(call, callId, turn, answerSources);
        default:
            return failureReceipt({
                callId,
                toolName: call.name,
                turn,
                code: 'unavailable-tool',
                safeMessage: 'Requested application tool is unavailable.',
                retryable: false,
            });
    }
}

async function executeMeasurement(
    measurement: NonNullable<RunApplicationOwnedToolLoopInput['measurement']>,
    call: ToolCallResult,
    context: MeasurementCallContext
): Promise<ExecutedRead> {
    let attempt: MeasurementAttempt | undefined;
    if (call.name === measurement.toolName) {
        attempt = {
            loopId: context.loopId,
            callId: context.callId,
            toolName: call.name,
            turn: context.turn,
            revision: measurement.revision,
        };
    }
    try {
        const result = await measurement.execute(call, context);
        return {
            ...result,
            ...(result.answerMeasurement === undefined
                ? {}
                : { answerSource: { kind: 'measurement' as const, value: result.answerMeasurement } }),
            measurementAttempt: attempt,
        };
    } catch {
        return {
            commands: null,
            receipt: failureReceipt({
                callId: context.callId,
                toolName: call.name,
                turn: context.turn,
                code: 'tool-execution-failed',
                safeMessage: 'Measurement failed inside the application authority.',
                retryable: true,
            }),
            measurementAttempt: attempt,
        };
    }
}

/**
 * One turn's reads, in call order. Only the turn's first measurement call executes: each renders
 * the project offline, so a later one in the same turn is refused without rendering.
 */
type ExecutedRead = {
    measurementAttempt?: MeasurementAttempt;
    answerSource?: AnswerReadSource;
    receipt: ApplicationToolReceipt;
    commands: readonly RetainedCommand[] | null;
    /** Set only by a recipe expansion; it is what makes the entry the loop retains a recipe, not a transform. */
    recipe?: AdoptedRecipe | null;
    metricRecipe?: MetricRecipeSource;
    /** Set only by a preview measurement; it is what makes the entry the loop retains a measured preview. */
    measuredPreview?: MeasuredPreview | null;
};

function retainedCompilationOf(executed: ExecutedRead, retainable: RetainedCommandSet): RetainedCompilation {
    if (executed.measuredPreview !== undefined && executed.measuredPreview !== null) {
        return { kind: 'preview', ...retainable, measuredPreview: executed.measuredPreview };
    }
    if (executed.recipe !== undefined && executed.recipe !== null) {
        return { kind: 'recipe', ...retainable, recipe: executed.recipe, metricRecipe: executed.metricRecipe };
    }
    return { kind: 'transform', ...retainable };
}

function executeTurnReads(input: {
    calls: readonly IdentifiedToolCall[];
    turn: number;
    loopId: string;
    measurement: RunApplicationOwnedToolLoopInput['measurement'];
    transientOnsetRead: RunApplicationOwnedToolLoopInput['transientOnsetRead'];
    transform: RunApplicationOwnedToolLoopInput['transform'];
    recipe: RunApplicationOwnedToolLoopInput['recipe'];
    nextRecipeOrdinal: () => number;
    retainedCompilations: readonly RetainedCompilation[];
    signal?: AbortSignal;
}): Promise<ExecutedRead>[] {
    const { measurement, turn } = input;
    const measurementToolNames = getMeasurementToolNames(measurement);
    const producedSources = new Map<string, AnswerReadSource>();
    const firstMeasurementIndex = input.calls.findIndex(({ call }) => measurementToolNames.includes(call.name));
    return input.calls.map(async ({ call, callId }, index) => {
        if (input.transientOnsetRead !== undefined && call.name === ANALYSIS_DETECT_TRANSIENTS_TOOL_NAME) {
            try {
                const receipt = await input.transientOnsetRead.execute({ call, callId, turn });
                const source = input.transientOnsetRead.readAnswerSource?.(callId);
                return {
                    commands: null,
                    receipt,
                    ...(source === undefined
                        ? {}
                        : { answerSource: { kind: 'source-onsets' as const, value: source } }),
                };
            } catch {
                return {
                    commands: null,
                    receipt: failureReceipt({
                        callId,
                        toolName: call.name,
                        turn,
                        code: 'tool-execution-failed',
                        safeMessage: 'Transient source read failed inside the application authority.',
                        retryable: true,
                    }),
                };
            }
        }
        if (input.transform !== undefined && call.name === input.transform.toolName) {
            try {
                return input.transform.execute(call, { callId, turn, loopId: input.loopId, signal: input.signal });
            } catch {
                return {
                    commands: null,
                    receipt: failureReceipt({
                        callId,
                        toolName: call.name,
                        turn,
                        code: 'tool-execution-failed',
                        safeMessage: 'Transform compilation failed inside the application authority.',
                        retryable: false,
                    }),
                };
            }
        }
        if (input.recipe !== undefined && call.name === input.recipe.toolName) {
            try {
                return input.recipe.execute(call, { callId, turn, ordinal: input.nextRecipeOrdinal() });
            } catch {
                return {
                    commands: null,
                    receipt: failureReceipt({
                        callId,
                        toolName: call.name,
                        turn,
                        code: 'tool-execution-failed',
                        safeMessage: 'Recipe expansion failed inside the application authority.',
                        retryable: false,
                    }),
                };
            }
        }
        if (measurement === undefined || !measurementToolNames.includes(call.name)) {
            const receipt = executeSafeRead(call, callId, turn, producedSources);
            return { receipt, commands: null, answerSource: producedSources.get(callId) };
        }
        if (index !== firstMeasurementIndex) {
            return {
                commands: null,
                receipt: failureReceipt({
                    callId,
                    toolName: call.name,
                    turn,
                    code: 'measure-per-turn-limit',
                    safeMessage: 'Only one measurement runs per turn; request it again in a later turn.',
                    retryable: true,
                }),
            };
        }
        return executeMeasurement(measurement, call, {
            callId,
            turn,
            loopId: input.loopId,
            signal: input.signal,
            retainedCompilations: input.retainedCompilations,
        });
    });
}

/** Only successful application catalog output earns a later local tool slot, never receipt text. */
function hasAdmittedTransientDiscovery(
    calls: readonly IdentifiedToolCall[],
    receipts: readonly ApplicationToolReceipt[]
): boolean {
    const canonical: ToolSchema | undefined = getAgentToolCatalogSchemas().find(
        (schema) => schema.function.name === ANALYSIS_DETECT_TRANSIENTS_TOOL_NAME
    );
    if (canonical === undefined) {
        return false;
    }
    return calls.some(({ call, callId }) => {
        if (call.name !== AGENT_CATALOG_DISCOVERY_TOOL_NAME) {
            return false;
        }
        const parsed = parseCatalogDiscoveryArguments(call.arguments);
        if (
            parsed.status !== 'valid' ||
            parsed.input.category !== 'analysis' ||
            !parsed.input.names.includes(ANALYSIS_DETECT_TRANSIENTS_TOOL_NAME)
        ) {
            return false;
        }
        const receipt = receipts.find((entry) => entry.callId === callId && entry.toolName === call.name);
        return (
            receipt?.status === 'success' &&
            isRecord(receipt.data) &&
            receipt.data.schema === 'sourdaw.agent-tool-catalog' &&
            receipt.data.schemaVersion === 1 &&
            receipt.data.category === 'analysis' &&
            Array.isArray(receipt.data.items) &&
            receipt.data.items.some((item: unknown) => canonicalJson(item) === canonicalJson(canonical))
        );
    });
}

function recordDisclosedCommandSchemas(
    calls: readonly { call: ToolCallResult }[],
    receipts: readonly ApplicationToolReceipt[],
    disclosedCommandSchemas: Map<string, string>
): void {
    for (const [index, receipt] of receipts.entries()) {
        const call = calls[index]?.call;
        if (
            call?.name !== AGENT_CATALOG_DISCOVERY_TOOL_NAME ||
            receipt.status !== 'success' ||
            !isRecord(receipt.data) ||
            receipt.data.category !== 'command' ||
            !Array.isArray(receipt.data.items)
        ) {
            continue;
        }
        for (const item of receipt.data.items) {
            if (!isRecord(item) || !isRecord(item.function) || typeof item.function.name !== 'string') {
                continue;
            }
            disclosedCommandSchemas.set(item.function.name, JSON.stringify(item));
        }
    }
}

/**
 * The intents this run actually looked up. An `unsupported` decline is a claim about the catalog,
 * and the user is owed what was searched before believing it; the intent lives only on the call, so
 * it is recorded here rather than re-derived from a receipt that never carried it.
 */
function recordSearchedIntents(
    calls: readonly { call: ToolCallResult }[],
    receipts: readonly ApplicationToolReceipt[],
    searchedIntents: string[]
): void {
    for (const [index, receipt] of receipts.entries()) {
        const call = calls[index]?.call;
        if (call?.name !== AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME || receipt.status !== 'success') {
            continue;
        }
        const intent = call.arguments.intent;
        if (typeof intent === 'string' && intent.length > 0 && !searchedIntents.includes(intent)) {
            searchedIntents.push(intent);
        }
    }
}

/**
 * The arguments `command.batch.propose` may carry. Whether `refines` names this thread's pending
 * proposal is the planner's to check against the thread; the loop holds only its shape.
 */
const COMMAND_BATCH_PROPOSAL_KEYS: ReadonlySet<string> = new Set([
    'commands',
    'list',
    'plan',
    'compiledCallIds',
    'refines',
]);

function validateCommandBatchProposal(
    call: ToolCallResult,
    disclosedCommandSchemas: ReadonlyMap<string, string>,
    retainedCompilations: ReadonlyMap<string, RetainedCompilation>
): string | null {
    const hasPrimitiveCommands = Array.isArray(call.arguments.commands);
    const list = isRecord(call.arguments.list) ? call.arguments.list : null;
    const hasStructuredList = list !== null && Array.isArray(list.items);
    const references = call.arguments.compiledCallIds;
    if (
        references !== undefined &&
        (!Array.isArray(references) ||
            references.length === 0 ||
            references.length > MAX_LLM_ACTIONS_PER_BATCH ||
            !references.every(
                (entry): entry is string =>
                    typeof entry === 'string' && entry.length > 0 && entry.length <= MAX_CALL_ID_LENGTH
            ) ||
            new Set(references).size !== references.length ||
            references.some((entry) => !retainedCompilations.has(entry)))
    ) {
        return 'Provider referenced an unknown, duplicate, or failed transform compilation or recipe expansion, or measured preview.';
    }
    const selectedCount = Array.isArray(references)
        ? references.reduce((count, callId) => count + (retainedCompilations.get(callId)?.commands.length ?? 0), 0)
        : 0;
    const refines = call.arguments.refines;
    if (
        Object.keys(call.arguments).some((key) => !COMMAND_BATCH_PROPOSAL_KEYS.has(key)) ||
        (refines !== undefined &&
            refines !== null &&
            (typeof refines !== 'string' || refines.length === 0 || refines.length > PROPOSAL_REFINES_MAX_LENGTH)) ||
        hasPrimitiveCommands === hasStructuredList ||
        (hasStructuredList && normalizeAgentPlanProposal(call.arguments.plan) === null)
    ) {
        return 'Provider command proposal does not match the strict catalog contract.';
    }
    const commands: unknown[] = hasPrimitiveCommands
        ? (call.arguments.commands as unknown[])
        : (list!.items as unknown[]);
    const commandLimit = hasPrimitiveCommands ? MAX_LLM_ACTIONS_PER_BATCH : SEMANTIC_COMMAND_LIST_MAX_ITEMS;
    if (
        commands.length + selectedCount === 0 ||
        commands.length > commandLimit ||
        commands.length + selectedCount > MAX_LLM_ACTIONS_PER_BATCH
    ) {
        return 'Provider command proposal exceeds the command budget.';
    }
    for (const command of commands) {
        if (!isRecord(command)) {
            return 'Provider command proposal does not match the strict catalog contract.';
        }
        const allowedKeys = hasPrimitiveCommands
            ? ['name', 'arguments']
            : ['id', 'name', 'arguments', 'selector', 'repeat', 'dependsOn'];
        if (Object.keys(command).some((key) => !allowedKeys.includes(key))) {
            return 'Provider command proposal does not match the strict catalog contract.';
        }
        if (
            typeof command.name !== 'string' ||
            command.name.length === 0 ||
            command.name.length > 128 ||
            !isRecord(command.arguments)
        ) {
            return 'Provider command proposal does not match the strict catalog contract.';
        }
        const disclosedSchema = disclosedCommandSchemas.get(command.name);
        if (disclosedSchema === undefined) {
            return 'Provider command proposal referenced an undiscovered catalog command.';
        }
        try {
            const currentEntry = getAgentToolCatalogEntries({
                category: 'command',
                names: [command.name],
            }).items[0];
            if (currentEntry === undefined || JSON.stringify(currentEntry) !== disclosedSchema) {
                return 'Provider command proposal referenced a stale catalog command schema.';
            }
        } catch {
            return 'Provider command proposal referenced an unavailable catalog command.';
        }
    }
    return null;
}

/**
 * A decline says the run produced no batch, so it may not ride alongside a call that produces one:
 * admitting both would leave the outcome of the turn ambiguous between refusal and proposal.
 */
function validateDeclineIsAlone(calls: readonly { call: ToolCallResult }[]): ValidatedDecline {
    const declineCalls = calls.filter(({ call }) => call.name === COMMAND_BATCH_DECLINE_TOOL_NAME);
    if (declineCalls.length === 0) {
        return { status: 'accepted', decline: null };
    }
    if (calls.length > 1) {
        return { status: 'rejected', reason: 'Provider combined a decline with another terminal call.' };
    }
    const parsed = parseCommandBatchDecline(declineCalls[0]!.call.arguments);
    return parsed.status === 'rejected'
        ? { status: 'rejected', reason: parsed.reason }
        : { status: 'accepted', decline: parsed.decline };
}

/**
 * An answer says the run changes nothing, so like a decline it may not ride alongside another
 * terminal call: a batch beside it would run while the reply claiming no change was shown. Its
 * evidence is resolved here against this run's own receipts, and only a call that succeeded can be
 * cited, so the answer never rests on a read that failed or never happened.
 */
function validateAnswerIsAlone(
    calls: readonly { call: ToolCallResult }[],
    receipts: readonly ApplicationToolReceipt[],
    intake: AdmittedAnswerIntake | null,
    answerReads: ReadonlyMap<string, AdmittedAnswerRead>
): ValidatedAnswer {
    const answerCalls = calls.filter(({ call }) => call.name === ANSWER_RESPOND_TOOL_NAME);
    if (answerCalls.length === 0) {
        return { status: 'accepted', answer: null };
    }
    if (calls.length > 1) {
        return { status: 'rejected', reason: 'Provider combined an answer with another terminal call.' };
    }
    const parsed = parseAnswerRespond(answerCalls[0]!.call.arguments, getAgentMeasurementMetricIds());
    if (parsed.status === 'rejected') {
        return parsed;
    }
    return composeMeasuredAnswer({ document: parsed.answer, intake, reads: answerReads, receipts });
}

type TerminalCallRejection = { status: 'rejected'; reason: string };
type ValidatedDecline = { status: 'accepted'; decline: CommandBatchDecline | null } | TerminalCallRejection;
type ValidatedAnswer = { status: 'accepted'; answer: PlanningAnswer | null } | TerminalCallRejection;

/**
 * The decline and the answer are parsed here and nowhere else. A caller that re-parsed them would
 * own a rejection branch this validation has already made unreachable, and would have to guess what
 * to do in it.
 */
type ValidatedTerminalCalls =
    { status: 'accepted'; decline: CommandBatchDecline | null; answer: PlanningAnswer | null } | TerminalCallRejection;

/**
 * One turn proposes one batch. Two proposals leave no answer to which one the run made, and the
 * compiler downstream reads a single proposal — so a second one would slip past the budget and the
 * target rules that only ever examine the first. Refusing here says so in a reason the model sees.
 */
function validateOneProposalPerTurn(calls: readonly { call: ToolCallResult }[]): string | null {
    const proposalCount = calls.filter(({ call }) => call.name === COMMAND_BATCH_PROPOSAL_TOOL_NAME).length;
    return proposalCount > 1 ? 'Provider returned more than one command batch proposal in one turn.' : null;
}

function validateCatalogTerminalCalls(
    calls: readonly { call: ToolCallResult }[],
    disclosedCommandSchemas: ReadonlyMap<string, string>,
    retainedCompilations: ReadonlyMap<string, RetainedCompilation>,
    compilationRevisions: Readonly<Record<RetainedCompilation['kind'], string | undefined>>,
    receipts: readonly ApplicationToolReceipt[],
    answerIntake: AdmittedAnswerIntake | null,
    answerReads: ReadonlyMap<string, AdmittedAnswerRead>
): ValidatedTerminalCalls {
    const declineValidation = validateDeclineIsAlone(calls);
    if (declineValidation.status === 'rejected') {
        return declineValidation;
    }
    const answerValidation = validateAnswerIsAlone(calls, receipts, answerIntake, answerReads);
    if (answerValidation.status === 'rejected') {
        return answerValidation;
    }
    const proposalCountRejection = validateOneProposalPerTurn(calls);
    if (proposalCountRejection !== null) {
        return { status: 'rejected', reason: proposalCountRejection };
    }
    for (const { call } of calls) {
        if (call.name !== COMMAND_BATCH_PROPOSAL_TOOL_NAME) {
            continue;
        }
        const rejection = validateCommandBatchProposal(call, disclosedCommandSchemas, retainedCompilations);
        if (rejection !== null) {
            return { status: 'rejected', reason: rejection };
        }
        const references = call.arguments.compiledCallIds;
        if (
            Array.isArray(references) &&
            references.some((callId: unknown) => {
                const retained = typeof callId === 'string' ? retainedCompilations.get(callId) : undefined;
                return retained === undefined || retained.revision !== compilationRevisions[retained.kind];
            })
        ) {
            return {
                status: 'rejected',
                reason: 'Provider referenced a stale transform compilation or recipe expansion, or measured preview.',
            };
        }
    }
    return { status: 'accepted', decline: declineValidation.decline, answer: answerValidation.answer };
}

/**
 * A strict reply states every optional property, as `null` when it means none. The proposal drops
 * those nulls here, so nothing downstream reads a `refines: null` as naming a card: a refinement
 * is absent in every form, and so are the list and plan beside a primitive command list.
 */
function normalizeTerminalProposalCall(call: ToolCallResult): ToolCallResult {
    if (call.name !== COMMAND_BATCH_PROPOSAL_TOOL_NAME) {
        return call;
    }
    const nullableKeys = Array.isArray(call.arguments.commands) ? ['list', 'plan', 'refines'] : ['refines'];
    return {
        ...call,
        arguments: Object.fromEntries(
            Object.entries(call.arguments).filter(([key, value]) => !nullableKeys.includes(key) || value !== null)
        ),
    };
}

/** One accepted call of a turn, under the identity the loop resolved for it. */
type IdentifiedToolCall = { call: ToolCallResult; callId: string };
/** What native history records for a turn whose executed calls are only part of its reply. */
type NativeTurnRecord = { calls: readonly IdentifiedToolCall[]; receipts: readonly ApplicationToolReceipt[] };

/** How the loop answers one reply to the single-measurement step. */
type MeasurementStepReply =
    | { status: 'rejected'; reason: string; receipts: ApplicationToolReceipt[] }
    | { status: 'unmeasured' }
    | { status: 'measured'; measureCalls: IdentifiedToolCall[]; record: NativeTurnRecord };

function orderReceiptsByCalls(
    calls: readonly IdentifiedToolCall[],
    receipts: readonly ApplicationToolReceipt[]
): ApplicationToolReceipt[] {
    return calls.flatMap(({ callId }) => receipts.filter((receipt) => receipt.callId === callId));
}

function resolveCallId(call: ToolCallResult, loopId: string, turn: number, index: number): string | null {
    if (call.id === undefined) {
        const synthesised = `${loopId}-${String(turn)}-${String(index)}`;
        return synthesised.length <= MAX_CALL_ID_LENGTH && SYNTHESISED_CALL_ID_PATTERN.test(synthesised)
            ? synthesised
            : null;
    }
    return call.id.length > 0 && call.id.length <= MAX_CALL_ID_LENGTH && PROVIDER_CALL_ID_PATTERN.test(call.id)
        ? call.id
        : null;
}

/**
 * The record form of a turn's calls. The resolved identity is used rather than the provider's
 * own optional one, so a call the provider never named is replayed under the same identifier
 * its receipt carries instead of reaching a request builder without one.
 */
function toHostedTurnCalls(identifiedCalls: readonly IdentifiedToolCall[]): HostedTurnCall[] {
    return identifiedCalls.map(({ call, callId }) => ({ id: callId, name: call.name, arguments: call.arguments }));
}

function readCurrentMeasurementOpportunity(
    input: RunApplicationOwnedToolLoopInput,
    receipts: readonly ApplicationToolReceipt[],
    admittedIntake: MeasurementIntake | null,
    turn: number
): MeasurementOpportunity | null {
    if (admittedIntake === null || input.measurement === undefined) {
        return null;
    }
    const opportunity = input.readMeasurementOpportunity?.();
    if (
        opportunity === undefined ||
        opportunity === null ||
        !opportunity.required ||
        !opportunity.available ||
        opportunity.authorityId.length === 0 ||
        !sameMeasurementAuthority(opportunity, admittedIntake) ||
        opportunity.turn >= turn ||
        input.measurement.revision !== opportunity.revision
    ) {
        return null;
    }
    const intake = receipts.find((receipt) => receipt.callId === opportunity.callId);
    if (
        intake?.status !== 'success' ||
        intake.turn !== opportunity.turn ||
        intake.toolName !== admittedIntake.toolName
    ) {
        return null;
    }
    return opportunity;
}

function sameMeasurementAuthority(left: MeasurementOpportunity, right: MeasurementOpportunity): boolean {
    return (
        left.authorityId === right.authorityId &&
        left.callId === right.callId &&
        left.turn === right.turn &&
        left.revision === right.revision
    );
}

function admitsMeasurementAttempt(input: {
    attempt: MeasurementAttempt | undefined;
    opportunity: MeasurementOpportunity;
    raw: ApplicationToolReceipt;
    admitted: ApplicationToolReceipt | undefined;
    loopId: string;
    toolName: string;
    turn: number;
}): boolean {
    const { attempt, opportunity, raw, admitted } = input;
    return (
        attempt !== undefined &&
        admitted !== undefined &&
        attempt.loopId === input.loopId &&
        attempt.toolName === input.toolName &&
        attempt.turn === input.turn &&
        attempt.turn > opportunity.turn &&
        attempt.revision === opportunity.revision &&
        [raw, admitted].every(
            (receipt) =>
                receipt.callId === attempt.callId &&
                receipt.toolName === attempt.toolName &&
                receipt.turn === attempt.turn &&
                (receipt.revision === opportunity.revision ||
                    (receipt.status === 'failure' && receipt.revision === null))
        )
    );
}

function toolChoiceRefusal(
    calls: readonly ToolCallResult[],
    directive: HostedToolChoiceDirective,
    finalTurn: boolean
): string | null {
    if (directive.mode === 'required' && calls.length === 0) {
        if (finalTurn) {
            return 'Provider returned no tool call on the final application tool-loop turn.';
        }
        return 'Provider returned no tool call on a required application tool-loop step.';
    }
    if (directive.parallelToolCalls === false && calls.length > 1) {
        return 'Provider returned multiple tool calls on a single-call application tool-loop step.';
    }
    if (directive.mode === 'required' && calls.some((call) => !directive.toolNames.includes(call.name))) {
        return 'Provider returned a tool outside the required application tool-loop set.';
    }
    return null;
}

export const APPLICATION_OWNED_TOOL_SCHEMAS: readonly ToolSchema[] = getAgentToolCatalogSchemas();

export async function runApplicationOwnedToolLoop(
    input: RunApplicationOwnedToolLoopInput
): Promise<ApplicationOwnedToolLoopOutcome> {
    const limits = { ...APPLICATION_OWNED_TOOL_LOOP_LIMITS, ...input.limits };
    const receipts: ApplicationToolReceipt[] = [];
    const seenCallIds = new Set<string>();
    const disclosedCommandSchemas = new Map<string, string>();
    const retainedCompilations = new Map<string, RetainedCompilation>();
    const searchedIntents: string[] = [];
    let recipeExpansionCount = 0;
    const nextRecipeOrdinal = (): number => {
        recipeExpansionCount += 1;
        return recipeExpansionCount;
    };
    let totalCalls = 0;
    let totalReceiptBytes = 0;
    let receiptContext: string | null = null;
    const history: HostedTurnRecord[] = [];
    let transientOnsetsDiscovered = false;
    let answerIntake: AdmittedAnswerIntake | null = null;
    let metricProviderProjection: { kind: 'metric-intent'; catalogId: string } | undefined;
    let answerEntry = false;
    const answerReads = new Map<string, AdmittedAnswerRead>();
    let interpretation: ApplicationOwnedToolLoopInterpretationOutcome = 'none';
    let wholeRequestIntake: WholeRequestIntakePhase = 'pending';
    let measurementIntake: MeasurementIntake | null = null;
    let measurementWitness: { opportunity: MeasurementOpportunity; receipt: ApplicationToolReceipt } | null = null;
    let heldTerminal: HeldTerminal | null = null;

    const hasMeasurementWitness = (opportunity: MeasurementOpportunity): boolean =>
        measurementWitness !== null && sameMeasurementAuthority(measurementWitness.opportunity, opportunity);

    const releaseHeldTerminal = (held: HeldTerminal, turn: number): ApplicationOwnedToolLoopOutcome => {
        const validation = validateCatalogTerminalCalls(
            held.calls,
            disclosedCommandSchemas,
            retainedCompilations,
            {
                transform: input.transform?.revision,
                recipe: input.recipe?.revision,
                preview: input.measurement?.revision,
            },
            receipts,
            answerIntake,
            answerReads
        );
        if (validation.status === 'rejected') {
            return { status: 'rejected', reason: validation.reason, receipts, turns: turn };
        }
        const witness = measurementWitness;
        const admittedMeasurementIntake = measurementIntake;
        const intake =
            admittedMeasurementIntake === null
                ? undefined
                : receipts.find((receipt) => receipt.callId === admittedMeasurementIntake.callId);
        if (
            witness === null ||
            intake === undefined ||
            !sameMeasurementAuthority(witness.opportunity, held.opportunity)
        ) {
            return {
                status: 'rejected',
                reason: 'Held proposal has no admitted measurement settlement.',
                receipts,
                turns: turn,
            };
        }
        const receiptIdentity = (receipt: ApplicationToolReceipt): TerminalMeasurementSettlement['intake'] => ({
            callId: receipt.callId,
            toolName: receipt.toolName,
            turn: receipt.turn,
            receiptDigest: digest(receipt),
        });
        const deferred = held.calls.flatMap(({ callId }) =>
            receipts.filter((receipt) => receipt.callId === callId && receipt.turn === held.turn)
        );
        if (deferred.length !== held.calls.length) {
            return {
                status: 'rejected',
                reason: 'Held proposal control receipts are incomplete.',
                receipts,
                turns: turn,
            };
        }
        const settlement: TerminalMeasurementSettlement = {
            schemaVersion: 1,
            authorityId: witness.opportunity.authorityId,
            revision: witness.opportunity.revision,
            intake: receiptIdentity(intake),
            deferredCalls: deferred.map(receiptIdentity),
            measurement: receiptIdentity(witness.receipt),
        };
        const terminalMeasurementSettlement = JSON.stringify(settlement);
        if (byteLength(terminalMeasurementSettlement) > limits.maxReceiptBytesPerCall) {
            return {
                status: 'rejected',
                reason: 'Terminal measurement settlement exceeded the bounded receipt size.',
                receipts,
                turns: turn,
            };
        }
        return {
            status: 'complete',
            toolCalls: held.calls.map(({ call }) => normalizeTerminalProposalCall(call)),
            decline: null,
            answer: null,
            searchedIntents: [...searchedIntents],
            proposal: held.proposal,
            receipts,
            terminalMeasurementSettlement,
            turns: turn,
            interpretation,
            retainedCompilations: [...retainedCompilations.values()],
        };
    };

    /**
     * The turn ceiling for the run as it currently stands. Offering the tool buys nothing: only a run
     * that actually admitted an interpretation spends the extra turn, so a provider that leaves the
     * tool uncalled gets exactly the turns every other run gets.
     */
    const maxTurns = (): number =>
        interpretation === 'admitted' || answerIntake !== null
            ? limits.maxTurns + CREATIVE_TURN_ALLOWANCE
            : limits.maxTurns;

    /**
     * Admits one turn's receipts against the context budget. Every receipt the loop produces spends
     * the same allowance, so the control phase cannot buy context a read tool would have been refused.
     */
    const admitTurnReceipts = (
        turnReceipts: readonly ApplicationToolReceipt[],
        turn: number,
        outcome: Extract<ApplicationToolPlanningOutcome, { status: 'complete' }>,
        identifiedCalls: readonly IdentifiedToolCall[],
        selectedAnswerAuthority?: Parameters<typeof projectAnswerProviderReceipt>[1],
        nativeRecord?: NativeTurnRecord
    ): { reason: string; receipts: ApplicationToolReceipt[] } | null => {
        const overBudget = 'Application tool receipts exceeded the bounded context budget.';
        const turnBytes = byteLength(serializeReceiptContext(turnReceipts, turn));
        if (turnBytes > limits.maxReceiptBytesPerTurn || totalReceiptBytes + turnBytes > limits.maxTotalReceiptBytes) {
            return { reason: overBudget, receipts: [...receipts, ...turnReceipts] };
        }
        receipts.push(...turnReceipts);
        totalReceiptBytes += turnBytes;
        receiptContext = serializeReceiptContext(receipts, turn);
        if (byteLength(receiptContext) > limits.maxTotalReceiptBytes) {
            return { reason: overBudget, receipts };
        }
        const providerAnswerAuthority = selectedAnswerAuthority ?? answerIntake?.authority ?? metricProviderProjection;
        if (providerAnswerAuthority !== undefined) {
            receiptContext = serializeReceiptContext(
                receipts.map((receipt) => projectAnswerProviderReceipt(receipt, providerAnswerAuthority)),
                turn
            );
        }
        if (input.textReceiptCharacterBudget !== undefined) {
            receiptContext = formatReceiptContext(receiptContext, turn, input.textReceiptCharacterBudget);
        }
        if (
            outcome.providerTurn === undefined &&
            input.textReceiptCharacterBudget !== undefined &&
            receiptContext.length > input.textReceiptCharacterBudget
        ) {
            return { reason: 'Application tool receipts exceeded the bounded text context budget.', receipts };
        }
        // Only a provider that reported its own turn can be handed that turn back; a backend
        // that plans locally records nothing and keeps reading the text form above. Every hosted
        // turn is recorded, whether or not its items can be replayed verbatim, so a later turn
        // never loses the calls and receipts of the turns between it and the last record.
        if (outcome.providerTurn !== undefined) {
            history.push({
                turn,
                provider: outcome.providerTurn.provider,
                assistantItems: outcome.providerTurn.assistantItems,
                calls: toHostedTurnCalls(nativeRecord?.calls ?? identifiedCalls),
                receipts: [...(nativeRecord?.receipts ?? turnReceipts)],
            });
        }
        return null;
    };

    // Answers a reply to the single-measurement step, held proposal or not: the first primary
    // measurement runs, every other call is refused in native history only, and a reply without
    // one records that no measurement was requested, so the proposal stays unverified.
    const answerMeasurementStepReply = (
        toolName: string,
        opportunity: MeasurementOpportunity,
        identifiedCalls: readonly IdentifiedToolCall[],
        outcome: Extract<ApplicationToolPlanningOutcome, { status: 'complete' }>,
        turn: number
    ): MeasurementStepReply => {
        const measureCalls = identifiedCalls.filter(({ call }) => call.name === toolName);
        const record: NativeTurnRecord = {
            calls: identifiedCalls,
            receipts: identifiedCalls
                .filter(({ call }) => call.name !== toolName)
                .map(({ call, callId }) =>
                    boundReceipt(
                        failureReceipt({
                            callId,
                            toolName: call.name,
                            turn,
                            code: 'measurement-step-refused',
                            safeMessage: 'Only the required measurement runs on this step; this call did not run.',
                            retryable: false,
                        }),
                        limits.maxReceiptBytesPerCall
                    )
                ),
        };
        if (measureCalls.length > 0) {
            return { status: 'measured', measureCalls, record };
        }
        const unmeasured = boundReceipt(
            failureReceipt({
                callId: `${input.loopId}-${String(turn)}-measurement-step`,
                toolName,
                turn,
                code: 'measurement-not-requested',
                safeMessage: 'The provider did not request the required measurement; the proposal is unverified.',
                retryable: false,
            }),
            limits.maxReceiptBytesPerCall
        );
        if (seenCallIds.has(unmeasured.callId)) {
            return {
                status: 'rejected',
                reason: 'Provider returned an invalid or duplicate tool-call identity.',
                receipts,
            };
        }
        seenCallIds.add(unmeasured.callId);
        const overBudget = admitTurnReceipts([unmeasured], turn, outcome, identifiedCalls, undefined, record);
        if (overBudget !== null) {
            return { status: 'rejected', ...overBudget };
        }
        measurementWitness = { opportunity: structuredClone(opportunity), receipt: structuredClone(unmeasured) };
        return { status: 'unmeasured' };
    };

    for (let turn = 1; turn <= maxTurns(); turn += 1) {
        if (input.signal?.aborted) {
            return {
                status: 'rejected',
                reason: 'Application-owned tool loop was cancelled.',
                receipts,
                turns: turn - 1,
            };
        }
        const isFinalTurn = turn === maxTurns();
        // A held candidate can still receive the real executor's stale-snapshot refusal. Snapshot
        // movement itself is neither an invocation nor a receipt and cannot settle its control.
        const measurementOpportunity: MeasurementOpportunity | null =
            readCurrentMeasurementOpportunity(input, receipts, measurementIntake, turn) ??
            heldTerminal?.opportunity ??
            null;
        const needsMeasurementStep =
            measurementOpportunity !== null &&
            !hasMeasurementWitness(measurementOpportunity) &&
            (heldTerminal !== null || turn === maxTurns() - 1);
        // Voluntary reads can share a turn. A held proposal or the penultimate turn reserves
        // one missing primary receipt; a held complete proposal needs no later proposal turn.
        let directive: HostedToolChoiceDirective = AUTO_TOOL_CHOICE;
        if (needsMeasurementStep && input.measurement !== undefined) {
            directive = { mode: 'required', toolNames: [input.measurement.toolName], parallelToolCalls: false };
        } else if (isFinalTurn) {
            directive = {
                mode: 'required',
                toolNames:
                    answerIntake === null
                        ? [...input.terminalToolNames]
                        : [ANSWER_RESPOND_TOOL_NAME, COMMAND_BATCH_DECLINE_TOOL_NAME],
            };
        }
        let outcome: ApplicationToolPlanningOutcome;
        try {
            const remaining = {
                turns: maxTurns() - turn + 1,
                calls: limits.maxTotalCalls - totalCalls,
                receiptBytes: limits.maxTotalReceiptBytes - totalReceiptBytes,
            };
            const lastRecordedTurn = history.at(-1)?.turn;
            const answerAuthorityForTurn = answerIntake?.authority ?? metricProviderProjection;
            outcome = await input.requestTurn({
                turn,
                ...(input.requireWholeRequestIntake ? { wholeRequestIntake } : {}),
                receiptContext,
                ...(answerIntake === null ? {} : { answerOnly: true as const }),
                ...(answerEntry && answerIntake === null ? { answerIntakeOnly: true as const } : {}),
                history: history.map((record) =>
                    answerAuthorityForTurn === undefined
                        ? record
                        : {
                              ...record,
                              receipts: record.receipts.map((receipt) =>
                                  projectAnswerProviderReceipt(receipt, answerAuthorityForTurn)
                              ),
                          }
                ),
                ...(transientOnsetsDiscovered ? { transientOnsetsDiscovered: true as const } : {}),
                budgetNote:
                    lastRecordedTurn === undefined ? '' : serializeRemainingBudgetNote(lastRecordedTurn, remaining),
                remaining,
                directive,
            });
        } catch (error) {
            throw new ApplicationOwnedToolLoopRequestError(error, receipts, turn);
        }
        if (outcome.status === 'rejected') {
            return { ...outcome, receipts, turns: turn };
        }
        if (input.signal?.aborted) {
            return { status: 'rejected', reason: 'Application-owned tool loop was cancelled.', receipts, turns: turn };
        }
        // A run outlives a measurement step its provider did not honour: some providers cannot
        // disable parallel calls or ignore the directive outright.
        const measurementStepToolName = needsMeasurementStep ? input.measurement?.toolName : undefined;
        const directiveRefusal =
            measurementStepToolName === undefined ? toolChoiceRefusal(outcome.toolCalls, directive, isFinalTurn) : null;
        if (directiveRefusal !== null) {
            return { status: 'rejected', reason: directiveRefusal, receipts, turns: turn };
        }

        let identifiedCalls: IdentifiedToolCall[] = [];
        for (const [index, call] of outcome.toolCalls.entries()) {
            const callId = resolveCallId(call, input.loopId, turn, index);
            if (callId === null || seenCallIds.has(callId)) {
                return {
                    status: 'rejected',
                    reason: 'Provider returned an invalid or duplicate tool-call identity.',
                    receipts,
                    turns: turn,
                };
            }
            seenCallIds.add(callId);
            identifiedCalls.push({ call, callId });
        }

        let measurementStepRecord: NativeTurnRecord | undefined;
        let admittedCallCount = outcome.toolCalls.length;
        if (measurementStepToolName !== undefined && measurementOpportunity !== null) {
            const reply = answerMeasurementStepReply(
                measurementStepToolName,
                measurementOpportunity,
                identifiedCalls,
                outcome,
                turn
            );
            if (reply.status === 'rejected') {
                return { status: 'rejected', reason: reply.reason, receipts: reply.receipts, turns: turn };
            }
            if (reply.status === 'unmeasured') {
                if (heldTerminal !== null) {
                    return releaseHeldTerminal(heldTerminal, turn);
                }
                continue;
            }
            measurementStepRecord = reply.record;
            identifiedCalls = reply.measureCalls;
            outcome = { ...outcome, toolCalls: reply.measureCalls.map(({ call }) => call) };
            // Only the first measurement runs; the step's other calls never run and spend nothing.
            admittedCallCount = 1;
        }
        if (admittedCallCount > limits.maxCallsPerTurn) {
            return {
                status: 'rejected',
                reason: 'Provider exceeded the application tool-call budget for one turn.',
                receipts,
                turns: turn,
            };
        }
        totalCalls += admittedCallCount;
        if (totalCalls > limits.maxTotalCalls) {
            return {
                status: 'rejected',
                reason: 'Provider exceeded the total application tool-call budget.',
                receipts,
                turns: turn,
            };
        }

        if (
            input.requireWholeRequestIntake &&
            wholeRequestIntake === 'pending' &&
            identifiedCalls.some(
                ({ call }) =>
                    isExecutableAppActionType(call.name) ||
                    WHOLE_REQUEST_PREPARATION_TOOL_NAMES.has(call.name) ||
                    (call.name === ANALYSIS_MEASURE_TOOL_NAME &&
                        (call.arguments.subject === 'preview' ||
                            call.arguments.proposal !== undefined ||
                            call.arguments.recipeCallId !== undefined))
            )
        ) {
            return {
                status: 'rejected',
                reason: 'Whole-request intake is required before preparation, compilation or proposal.',
                receipts,
                turns: turn,
            };
        }

        const entryCalls = identifiedCalls.filter(
            ({ call }) => call.name === ANSWER_RESPOND_TOOL_NAME && Object.keys(call.arguments).length === 0
        );
        if (entryCalls.length > 0) {
            if (identifiedCalls.length !== 1 || answerEntry || answerIntake !== null || interpretation !== 'none') {
                return {
                    status: 'rejected',
                    reason: 'Provider repeated or mixed the answer entry phase.',
                    receipts,
                    turns: turn,
                };
            }
            const selected = entryCalls[0]!;
            const receipt: ApplicationToolReceipt = {
                schema: 'sourdaw.application-tool-receipt',
                schemaVersion: 1,
                callId: selected.callId,
                toolName: selected.call.name,
                turn,
                status: 'success',
                revision: null,
                data: { phase: 'answer-intake' },
                summary: 'Read-only answering entered; interpretation is still required.',
                warnings: [],
                error: null,
            };
            const overBudget = admitTurnReceipts([receipt], turn, outcome, identifiedCalls);
            if (overBudget !== null) {
                return { status: 'rejected', reason: overBudget.reason, receipts: overBudget.receipts, turns: turn };
            }
            answerEntry = true;
            continue;
        }
        if (
            answerEntry &&
            answerIntake === null &&
            identifiedCalls.some(
                ({ call }) =>
                    ![
                        ANSWER_INTERPRETATION_TOOL_NAME,
                        PROJECT_QUERY_TOOL_NAME,
                        COMMAND_BATCH_DECLINE_TOOL_NAME,
                    ].includes(call.name)
            )
        ) {
            return {
                status: 'rejected',
                reason: 'Answer entry cannot authorize reads or effects before intake.',
                receipts,
                turns: turn,
            };
        }
        const answerSelections = identifiedCalls.filter(
            ({ call }) =>
                call.name === ANSWER_INTERPRETATION_TOOL_NAME ||
                (input.answerInterpretation?.jointToolName === call.name &&
                    call.arguments.answer !== undefined &&
                    call.arguments.answer !== null)
        );
        if (answerSelections.length > 0) {
            if (
                input.answerInterpretation === undefined ||
                identifiedCalls.length !== 1 ||
                answerIntake !== null ||
                interpretation !== 'none'
            ) {
                return {
                    status: 'rejected',
                    reason: 'Provider mixed, repeated or contradicted the answer interpretation.',
                    receipts,
                    turns: turn,
                };
            }
            const selected = answerSelections[0]!;
            const admitted = input.answerInterpretation.admit(selected.call);
            if (admitted.status !== 'admitted') {
                if (admitted.status === 'rejected') {
                    return { status: 'rejected', reason: admitted.reason, receipts, turns: turn };
                }
                return {
                    status: 'complete',
                    toolCalls: [],
                    decline: { kind: 'clarify', reason: admitted.reason, questions: [admitted.reason] },
                    answer: null,
                    searchedIntents: [...searchedIntents],
                    proposal: null,
                    receipts,
                    turns: turn,
                    interpretation: 'clarified',
                    retainedCompilations: [],
                };
            }
            const authority = structuredClone(admitted.authority);
            const receipt = boundReceipt(
                {
                    schema: 'sourdaw.application-tool-receipt',
                    schemaVersion: 1,
                    callId: selected.callId,
                    toolName: selected.call.name,
                    turn,
                    status: 'success',
                    revision: authority.revision,
                    data: {
                        schemaVersion: authority.schemaVersion,
                        catalogId: authority.catalogId,
                        requestDigest: authority.requestDigest,
                        revision: authority.revision,
                        selection: authority.selection,
                        kind: authority.kind,
                        topics: authority.topics,
                        scopes: authority.scopes,
                        scopeCandidateIds: authority.scopeCandidateIds,
                        range: authority.range,
                        requiredMetrics: authority.requiredMetrics,
                    },
                    summary: `Interpreted ${authority.kind}: ${authority.scopes.flatMap((scope) => scope.labels).join(', ') || 'project context'}${authority.range === null ? '' : ` over ${authority.range.label}`}.`,
                    warnings: [],
                    error: null,
                },
                limits.maxReceiptBytesPerCall
            );
            const overBudget = admitTurnReceipts([receipt], turn, outcome, identifiedCalls, authority);
            if (overBudget !== null) {
                return { status: 'rejected', reason: overBudget.reason, receipts: overBudget.receipts, turns: turn };
            }
            if (receipt.status !== 'success') {
                return {
                    status: 'rejected',
                    reason: 'Answer interpretation exceeded the bounded receipt budget.',
                    receipts,
                    turns: turn,
                };
            }
            answerIntake = { callId: selected.callId, turn, authority };
            continue;
        }
        if (
            answerIntake !== null &&
            identifiedCalls.some(
                ({ call }) =>
                    ![
                        PROJECT_QUERY_TOOL_NAME,
                        RECIPE_DISCOVERY_TOOL_NAME,
                        AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                        AGENT_CATALOG_DISCOVERY_TOOL_NAME,
                        ANALYSIS_DETECT_TRANSIENTS_TOOL_NAME,
                        input.measurement?.toolName,
                        ANSWER_RESPOND_TOOL_NAME,
                        COMMAND_BATCH_DECLINE_TOOL_NAME,
                    ].includes(call.name) ||
                    (call.name === input.measurement?.toolName &&
                        call.arguments.subject !== undefined &&
                        call.arguments.subject !== 'project')
            )
        ) {
            return {
                status: 'rejected',
                reason: 'Answer interpretation cannot authorize a mutation, preview or preparation.',
                receipts,
                turns: turn,
            };
        }

        const interpretationCalls = identifiedCalls.filter(
            ({ call }) =>
                input.interpretation !== undefined &&
                (call.name === input.interpretation.toolName ||
                    (call.name === input.interpretation.workflowToolName &&
                        (wholeRequestIntake !== 'admitted' || Object.hasOwn(call.arguments, 'metricIntent'))))
        );
        if (interpretationCalls.length > 0) {
            // The interpretation decides what the rest of the run is allowed to mean, so it cannot
            // ride alongside calls whose meaning it would have settled.
            if (identifiedCalls.length !== 1) {
                return {
                    status: 'rejected',
                    reason: 'Provider mixed the creative interpretation with other tool calls in one turn.',
                    receipts,
                    turns: turn,
                };
            }
            if (interpretation === 'admitted') {
                return {
                    status: 'rejected',
                    reason: 'Provider repeated the creative interpretation.',
                    receipts,
                    turns: turn,
                };
            }
            const { call, callId } = interpretationCalls[0]!;
            const admission = input.interpretation!.admit({ ...call, id: callId }, { callId, turn });
            if (admission.status === 'rejected') {
                return { status: 'rejected', reason: admission.reason, receipts, turns: turn };
            }
            if (admission.status === 'clarify') {
                return {
                    status: 'complete',
                    toolCalls: [],
                    decline: {
                        kind: 'clarify',
                        reason: admission.reason,
                        questions: [admission.reason],
                    },
                    answer: null,
                    searchedIntents: [...searchedIntents],
                    proposal: null,
                    receipts,
                    turns: turn,
                    interpretation: 'clarified',
                    retainedCompilations: [],
                };
            }
            const receipt = boundReceipt(
                {
                    schema: 'sourdaw.application-tool-receipt',
                    schemaVersion: 1,
                    callId,
                    toolName: call.name,
                    turn,
                    status: 'success',
                    revision: null,
                    data: admission.receipt.data,
                    summary: admission.receipt.summary,
                    warnings: [],
                    error: null,
                },
                limits.maxReceiptBytesPerCall
            );
            const overBudget = admitTurnReceipts(
                [receipt],
                turn,
                outcome,
                interpretationCalls,
                admission.providerProjection
            );
            if (overBudget !== null) {
                return { status: 'rejected', reason: overBudget.reason, receipts: overBudget.receipts, turns: turn };
            }
            if (receipt.status !== 'success') {
                return {
                    status: 'rejected',
                    reason:
                        receipt.error?.safeMessage ?? 'Creative interpretation exceeded the bounded receipt budget.',
                    receipts,
                    turns: turn,
                };
            }
            if (input.requireWholeRequestIntake && admission.providerProjection?.kind !== 'metric-intent') {
                return {
                    status: 'rejected',
                    reason: 'Whole-request metric intent was not admitted.',
                    receipts,
                    turns: turn,
                };
            }
            if (admission.providerProjection?.kind === 'metric-intent') {
                wholeRequestIntake =
                    call.name === input.interpretation?.workflowToolName ? 'workflow-admitted' : 'admitted';
            }
            metricProviderProjection = admission.providerProjection;
            interpretation = 'admitted';
            const opportunity = input.readMeasurementOpportunity?.();
            if (
                opportunity !== null &&
                opportunity !== undefined &&
                opportunity.callId === callId &&
                opportunity.turn === turn
            ) {
                measurementIntake = { ...structuredClone(opportunity), toolName: call.name };
            }
            if (
                readCurrentMeasurementOpportunity(input, receipts, measurementIntake, turn + 1) !== null &&
                (maxTurns() - turn < 2 || limits.maxTotalCalls - totalCalls < 2)
            ) {
                return {
                    status: 'rejected',
                    reason: 'Whole-request intake left insufficient budget for measurement and a terminal proposal.',
                    receipts,
                    turns: turn,
                };
            }
            continue;
        }

        const safeReadToolNames = new Set([
            PROJECT_QUERY_TOOL_NAME,
            PROJECT_DISCOVERY_TOOL_NAME,
            PROJECT_RESOLVE_TOOL_NAME,
            AGENT_CAPABILITIES_TOOL_NAME,
            AGENT_DEVICE_MANIFEST_TOOL_NAME,
            AGENT_CATALOG_DISCOVERY_TOOL_NAME,
            AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
            COMMAND_HISTORY_TOOL_NAME,
            RECIPE_DISCOVERY_TOOL_NAME,
            ...getMeasurementToolNames(input.measurement),
            ...(input.transientOnsetRead === undefined ? [] : [ANALYSIS_DETECT_TRANSIENTS_TOOL_NAME]),
            ...(input.transform === undefined ? [] : [input.transform.toolName]),
            ...(input.recipe === undefined ? [] : [input.recipe.toolName]),
        ]);
        const safeReadCalls = identifiedCalls.filter(({ call }) => safeReadToolNames.has(call.name));
        const terminalCalls = identifiedCalls.filter(
            ({ call }) => !safeReadToolNames.has(call.name) && input.terminalToolNames.has(call.name)
        );
        if (safeReadCalls.length + terminalCalls.length !== outcome.toolCalls.length) {
            return {
                status: 'rejected',
                reason: 'Provider requested an unavailable application tool.',
                receipts,
                turns: turn,
            };
        }
        if (safeReadCalls.length > 0 && terminalCalls.length > 0) {
            return {
                status: 'rejected',
                reason: 'Provider mixed project reads with terminal action calls in one turn.',
                receipts,
                turns: turn,
            };
        }
        const terminalValidation = validateCatalogTerminalCalls(
            terminalCalls,
            disclosedCommandSchemas,
            retainedCompilations,
            {
                transform: input.transform?.revision,
                recipe: input.recipe?.revision,
                preview: input.measurement?.revision,
            },
            receipts,
            answerIntake,
            answerReads
        );
        if (terminalValidation.status === 'rejected') {
            return {
                status: 'rejected',
                reason: terminalValidation.reason,
                receipts,
                turns: turn,
            };
        }
        const declineRefusal =
            terminalValidation.decline === null || input.declineAdmission === undefined || answerIntake !== null
                ? null
                : input.declineAdmission(terminalValidation.decline);
        if (declineRefusal?.status === 'refused') {
            // The final turn has no later turn to correct in, so the refusal ends the run as the
            // typed rejection it is rather than as a clarification the application would not admit.
            if (isFinalTurn) {
                return {
                    status: 'rejected',
                    reason: 'Provider declined a request the application plans, and no turn remained to plan it.',
                    receipts,
                    turns: turn,
                };
            }
            const refusalReceipt = boundReceipt(
                failureReceipt({
                    callId: terminalCalls[0]!.callId,
                    toolName: COMMAND_BATCH_DECLINE_TOOL_NAME,
                    turn,
                    code: 'decline-not-admitted',
                    safeMessage: declineRefusal.reason,
                    retryable: true,
                }),
                limits.maxReceiptBytesPerCall
            );
            const refusalOverBudget = admitTurnReceipts([refusalReceipt], turn, outcome, terminalCalls);
            if (refusalOverBudget !== null) {
                return {
                    status: 'rejected',
                    reason: refusalOverBudget.reason,
                    receipts: refusalOverBudget.receipts,
                    turns: turn,
                };
            }
            continue;
        }
        // The final turn forces a terminal tool call; a reply that carries none there is never
        // accepted as an implicit no-op, unlike the same shape on an earlier turn.
        if (isFinalTurn && outcome.toolCalls.length === 0) {
            return {
                status: 'rejected',
                reason: 'Provider returned no tool call on the final application tool-loop turn.',
                receipts,
                turns: turn,
            };
        }
        if (terminalCalls.length > 0 || outcome.toolCalls.length === 0) {
            const opportunity = readCurrentMeasurementOpportunity(input, receipts, measurementIntake, turn);
            if (
                terminalCalls.length > 0 &&
                terminalValidation.decline === null &&
                terminalValidation.answer === null &&
                opportunity !== null &&
                !hasMeasurementWitness(opportunity)
            ) {
                if (isFinalTurn || limits.maxTotalCalls - totalCalls < 1) {
                    return {
                        status: 'rejected',
                        reason: 'Proposal completion has no remaining budget for its required measurement receipt.',
                        receipts,
                        turns: turn,
                    };
                }
                const deferredReceipts = terminalCalls.map(({ call, callId }) =>
                    boundReceipt(
                        failureReceipt({
                            callId,
                            toolName: call.name,
                            turn,
                            code: 'measurement-required',
                            safeMessage:
                                'Proposal completion is deferred until an application measurement receipt is admitted.',
                            retryable: true,
                        }),
                        limits.maxReceiptBytesPerCall
                    )
                );
                const deferredOverBudget = admitTurnReceipts(deferredReceipts, turn, outcome, terminalCalls);
                if (deferredOverBudget !== null) {
                    return {
                        status: 'rejected',
                        reason: deferredOverBudget.reason,
                        receipts: deferredOverBudget.receipts,
                        turns: turn,
                    };
                }
                if (deferredReceipts.some((receipt) => receipt.error?.code !== 'measurement-required')) {
                    return {
                        status: 'rejected',
                        reason: 'Deferred proposal exceeded the bounded receipt budget.',
                        receipts,
                        turns: turn,
                    };
                }
                heldTerminal = {
                    calls: structuredClone(terminalCalls),
                    proposal: structuredClone(outcome.proposal ?? extractAgentPlanProposal(outcome.toolCalls)),
                    turn,
                    opportunity: structuredClone(opportunity),
                };
                continue;
            }
            return {
                status: 'complete',
                toolCalls: terminalCalls.map(({ call }) => normalizeTerminalProposalCall(call)),
                decline:
                    answerIntake !== null && terminalValidation.decline !== null
                        ? {
                              ...terminalValidation.decline,
                              reason: 'This question cannot be answered from the available evidence.',
                              questions:
                                  terminalValidation.decline.kind === 'clarify'
                                      ? ['Please clarify the question, target or range to analyze.']
                                      : [],
                          }
                        : terminalValidation.decline,
                answer: terminalValidation.answer,
                searchedIntents: [...searchedIntents],
                proposal: outcome.proposal ?? extractAgentPlanProposal(outcome.toolCalls),
                receipts,
                turns: turn,
                interpretation,
                retainedCompilations: [...retainedCompilations.values()],
            };
        }
        if (isFinalTurn && heldTerminal === null) {
            return {
                status: 'rejected',
                reason: 'Provider exhausted the bounded application tool-loop turns.',
                receipts,
                turns: turn,
            };
        }

        const executedReads = await Promise.all(
            executeTurnReads({
                calls: safeReadCalls.map((identified) => {
                    const range = identified.call.arguments.range;
                    const frozen = answerIntake?.authority.range;
                    if (
                        identified.call.name !== input.measurement?.toolName ||
                        frozen?.sectionId === null ||
                        frozen === undefined ||
                        frozen === null ||
                        !isRecord(range) ||
                        range.startBeat !== frozen.startBeat ||
                        range.endBeat !== frozen.endBeat ||
                        Object.keys(range).some((key) => key !== 'startBeat' && key !== 'endBeat')
                    ) {
                        return identified;
                    }
                    return {
                        ...identified,
                        call: {
                            ...identified.call,
                            arguments: { ...identified.call.arguments, range: { sectionId: frozen.sectionId } },
                        },
                    };
                }),
                turn,
                loopId: input.loopId,
                measurement: input.measurement,
                transientOnsetRead: input.transientOnsetRead,
                transform: input.transform,
                recipe: input.recipe,
                nextRecipeOrdinal,
                retainedCompilations: [...retainedCompilations.values()],
                signal: input.signal,
            })
        );
        const rawTurnReceipts = executedReads.map(({ receipt }) =>
            boundReceipt(receipt, limits.maxReceiptBytesPerCall)
        );
        if (input.signal?.aborted) {
            return { status: 'rejected', reason: 'Application-owned tool loop was cancelled.', receipts, turns: turn };
        }
        // Over-budget reads are replaced with a compact retryable failure before admission, so a
        // turn whose reads only barely overflow the budget still lands the reads that fit instead
        // of failing the whole planning run.
        const turnReceipts = admitTurnReadReceipts({
            realReceipts: rawTurnReceipts,
            turn,
            totalReceiptBytesSoFar: totalReceiptBytes,
            maxReceiptBytesPerTurn: limits.maxReceiptBytesPerTurn,
            maxTotalReceiptBytes: limits.maxTotalReceiptBytes,
        });
        recordDisclosedCommandSchemas(safeReadCalls, turnReceipts, disclosedCommandSchemas);
        recordSearchedIntents(safeReadCalls, turnReceipts, searchedIntents);
        const overBudget = admitTurnReceipts(
            turnReceipts,
            turn,
            outcome,
            safeReadCalls,
            undefined,
            measurementStepRecord && {
                calls: measurementStepRecord.calls,
                receipts: orderReceiptsByCalls(measurementStepRecord.calls, [
                    ...turnReceipts,
                    ...measurementStepRecord.receipts,
                ]),
            }
        );
        if (overBudget !== null) {
            return { status: 'rejected', reason: overBudget.reason, receipts: overBudget.receipts, turns: turn };
        }
        transientOnsetsDiscovered ||= hasAdmittedTransientDiscovery(safeReadCalls, turnReceipts);
        const currentOpportunity = measurementOpportunity;
        for (const [index, executed] of executedReads.entries()) {
            const admitted = turnReceipts[index];
            if (
                currentOpportunity !== null &&
                admitted !== undefined &&
                admitsMeasurementAttempt({
                    attempt: executed.measurementAttempt,
                    opportunity: currentOpportunity,
                    raw: executed.receipt,
                    admitted,
                    loopId: input.loopId,
                    toolName: input.measurement?.toolName ?? '',
                    turn,
                })
            ) {
                measurementWitness = {
                    opportunity: structuredClone(currentOpportunity),
                    receipt: structuredClone(admitted),
                };
            }
            if (
                admitted?.status === 'success' &&
                admitted.callId === executed.receipt.callId &&
                executed.answerSource !== undefined
            ) {
                answerReads.set(admitted.callId, { receipt: admitted, source: structuredClone(executed.answerSource) });
            }
            if (
                executed.commands === null ||
                executed.commands === undefined ||
                admitted?.status !== 'success' ||
                admitted.revision === null ||
                admitted.callId !== executed.receipt.callId
            ) {
                continue;
            }
            const retainable = {
                callId: admitted.callId,
                revision: admitted.revision,
                commands: executed.commands,
            };
            retainedCompilations.set(admitted.callId, retainedCompilationOf(executed, retainable));
        }
        if (needsMeasurementStep && currentOpportunity !== null && !hasMeasurementWitness(currentOpportunity)) {
            return {
                status: 'rejected',
                reason: 'Measurement receipt did not match the required application step.',
                receipts,
                turns: turn,
            };
        }
        if (heldTerminal !== null) {
            return releaseHeldTerminal(heldTerminal, turn);
        }
    }

    return {
        status: 'rejected',
        reason: 'Provider exhausted the bounded application tool-loop turns.',
        receipts,
        turns: maxTurns(),
    };
}
