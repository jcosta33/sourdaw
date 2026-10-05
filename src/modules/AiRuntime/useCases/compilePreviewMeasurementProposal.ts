import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { doesProductionBriefAllowActionBatch } from '#/modules/Project/useCases';

import { COMMAND_BATCH_PROPOSAL_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { type CreativeRequestAuthority } from '../models/CreativeInterpretation';
import { type ProjectContext } from '../models/ProjectContext';
import { type RetainedCommand, type RetainedCommandSet } from '../models/RetainedCompilation';
import { type ToolCallResult } from '../transformers/toolCallParser';

import { bridgeGroundedLlmToolCalls } from './agentReference/bridgeGroundedLlmToolCalls';
import { materializeBatchLocalActionIdentities } from './agentReference/materializeBatchLocalActionIdentities';
import { compileArbitraryCommandList } from './compileArbitraryCommandList';
import { compilePlannedActionCommandBatch } from './compilePlannedActionCommandBatch';
import { materializeActionStateGuards } from './materializeActionStateGuards';
import { materializeTransformToolCalls } from './materializeTransformToolCalls';
import { readPlanningMarkerSignatures } from './readPlanningMarkerSignatures';
import { validateActions } from './validateActions';

type CompilePreviewMeasurementProposalInput = {
    callId: string;
    /** The provider's semantic command list, in the schema `command.batch.propose` takes it. */
    proposal: Readonly<Record<string, unknown>>;
    context: ProjectContext;
    prompt: string;
    revision: string;
    runId: string;
    creativeAuthority: CreativeRequestAuthority | undefined;
};

type CommandBatchEnvelope = Extract<
    ReturnType<typeof parseVersionedCommandBatchEnvelope>,
    { status: 'valid' }
>['envelope'];

type CompiledPreviewProposal =
    | { status: 'compiled'; commands: readonly RetainedCommand[]; envelope: CommandBatchEnvelope }
    | { status: 'rejected'; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compiledCommandsOf(call: ToolCallResult | undefined): ToolCallResult[] | null {
    const commands = call?.arguments.commands;
    if (!Array.isArray(commands)) {
        return null;
    }
    const valid = commands.filter(
        (command): command is ToolCallResult =>
            isRecord(command) && typeof command.name === 'string' && isRecord(command.arguments)
    );
    return valid.length === commands.length ? valid : null;
}

/** The binding names an argument value refers to, as `$name`. */
function referencedBindings(argumentsValue: Readonly<Record<string, unknown>>): string[] {
    return Object.values(argumentsValue).flatMap((value) =>
        typeof value === 'string' && value.startsWith('$') ? [value.slice(1)] : []
    );
}

/**
 * The compiled list as retained commands: each keyed by its position, its binding lifted out of
 * its arguments, and depending on the earlier commands that mint the bindings it refers to — the
 * form an adopting proposal grounds through the same route a transform compilation takes.
 */
function toRetainedCommands(commands: readonly ToolCallResult[]): RetainedCommand[] {
    const keyByBinding = new Map<string, string>();
    return commands.map((command, index) => {
        const { binding, ...argumentsValue } = command.arguments;
        const key = String(index);
        const dependencyKeys = referencedBindings(argumentsValue).flatMap((name) => {
            const dependencyKey = keyByBinding.get(name);
            return dependencyKey === undefined ? [] : [dependencyKey];
        });
        if (typeof binding === 'string') {
            keyByBinding.set(binding, key);
        }
        return {
            key,
            stepId: `preview-item-${key}`,
            operation: command.name,
            arguments: argumentsValue,
            reason: 'Measured preview command.',
            expectedEffect: '',
            binding: typeof binding === 'string' ? binding : null,
            dependencyKeys,
        };
    });
}

function groundRetainedCommands(input: CompilePreviewMeasurementProposalInput, retained: RetainedCommandSet) {
    return bridgeGroundedLlmToolCalls({
        calls: materializeTransformToolCalls([retained]),
        context: input.context,
        ...readPlanningMarkerSignatures(),
        prompt: input.prompt,
        transformProof: {
            revision: input.revision,
            creativeAuthorityId: input.creativeAuthority?.authorityId ?? null,
            compilations: [retained],
        },
        projectRevision: input.revision,
        creativeAuthority: input.creativeAuthority,
    });
}

/** Ground, validate and state-guard the retained commands exactly as an adopting proposal will. */
function admitRetainedCommands(input: CompilePreviewMeasurementProposalInput, retained: RetainedCommandSet) {
    const bridged = groundRetainedCommands(input, retained);
    if (bridged.rejections.length > 0) {
        const reason = bridged.rejections.map((rejection) => `${rejection.name}: ${rejection.reason}`).join('; ');
        return { status: 'rejected' as const, reason: `The proposal list failed grounding: ${reason}` };
    }
    const validated = validateActions(bridged.actions, bridged.batchLocalActionIdentities);
    if (validated.length !== bridged.actions.length) {
        return { status: 'rejected' as const, reason: 'The proposal list failed runtime validation.' };
    }
    const materialized = materializeBatchLocalActionIdentities(validated, bridged.batchLocalActionIdentities ?? []);
    if (materialized.status === 'rejected') {
        return { status: 'rejected' as const, reason: materialized.reason };
    }
    const guarded = materializeActionStateGuards(materialized.actions, input.context, {
        appOwnedRenderTailSeconds: bridged.appOwnedRenderTailSeconds,
        bassProcessingCopyScope: bridged.bassProcessingCopyScope,
        midiOverlapTransformScope: bridged.midiOverlapTransformScope,
        drumPreviewBranchesScope: bridged.drumPreviewBranchesScope,
        syncopatedArpeggioScope: bridged.syncopatedArpeggioScope,
    });
    if (guarded.status === 'rejected') {
        return { status: 'rejected' as const, reason: guarded.reason };
    }
    if (!doesProductionBriefAllowActionBatch(guarded.actions)) {
        return { status: 'rejected' as const, reason: 'The proposal list conflicts with locked production intent.' };
    }
    return { status: 'admitted' as const, actions: guarded.actions, actionCommandGraph: bridged.actionCommandGraph };
}

/**
 * Compile one preview measurement's semantic list into the batch a proposal adopting it would
 * become: the list compiler a proposal uses, then grounding with the list as an adopted
 * compilation, runtime validation, state guards and the versioned command batch, all against the
 * loop's revision and project read model. Nothing here touches the project.
 */
export function compilePreviewMeasurementProposal(
    input: CompilePreviewMeasurementProposalInput
): CompiledPreviewProposal {
    const compiled = compileArbitraryCommandList({
        calls: [{ name: COMMAND_BATCH_PROPOSAL_TOOL_NAME, arguments: { list: input.proposal } }],
        context: input.context,
        revision: input.revision,
        creativeAuthority: input.creativeAuthority,
    });
    if (compiled.status === 'rejected') {
        return { status: 'rejected', reason: `The proposal list did not compile: ${compiled.reason}` };
    }
    const commands = compiledCommandsOf(compiled.calls[0]);
    if (commands === null || commands.length === 0) {
        return { status: 'rejected', reason: 'The proposal list compiled to no command to measure.' };
    }
    const retained: RetainedCommandSet = {
        callId: input.callId,
        revision: input.revision,
        commands: toRetainedCommands(commands),
    };
    const admitted = admitRetainedCommands(input, retained);
    if (admitted.status === 'rejected') {
        return admitted;
    }
    const { commandBatch } = compilePlannedActionCommandBatch({
        actions: admitted.actions,
        actionCommandGraph: admitted.actionCommandGraph,
        actionLabels: admitted.actions.map((action) => action.type),
        autoCommit: false,
        group: { groupId: `measure-${input.callId}`, groupLabel: 'Measured preview' },
        intent: input.prompt,
        mode: 'preview',
        projectRevision: input.revision,
        runId: input.runId,
        context: input.context,
    });
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status === 'invalid') {
        return { status: 'rejected', reason: parsed.reason };
    }
    return { status: 'compiled', commands: retained.commands, envelope: parsed.envelope };
}
