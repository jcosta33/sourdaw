import { MAX_LLM_ACTIONS_PER_BATCH } from '../models/LlmActionLimits';
import { type RetainedCompilation } from '../models/RetainedCompilation';
import { SEMANTIC_COMMAND_LIST_MAX_ITEMS } from '../models/SemanticCommandList';
import { PROPOSAL_REFINES_MAX_LENGTH } from '../models/ThreadContext';
import { normalizeAgentPlanProposal } from '../transformers/normalizeAgentPlanProposal';
import { type ToolCallResult } from '../transformers/toolCallParser';

import { getAgentToolCatalogEntries } from './getAgentToolCatalogEntries';

const MAX_CALL_ID_LENGTH = 256;
const STRICT_CATALOG_REFUSAL = 'Provider command proposal does not match the strict catalog contract.';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function validReferences(
    references: unknown,
    retainedCompilations: ReadonlyMap<string, RetainedCompilation>
): references is string[] | undefined {
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
        return false;
    }
    return true;
}

function validCommand(command: unknown, allowedKeys: readonly string[]): command is { name: string } {
    return (
        isRecord(command) &&
        Object.keys(command).every((key) => allowedKeys.includes(key)) &&
        typeof command.name === 'string' &&
        command.name.length > 0 &&
        command.name.length <= 128 &&
        isRecord(command.arguments)
    );
}

function validateCommands(
    commands: unknown[],
    hasPrimitiveCommands: boolean,
    disclosedCommandSchemas: ReadonlyMap<string, string>
): string | null {
    const allowedKeys = ['name', 'arguments'];
    if (!hasPrimitiveCommands) {
        allowedKeys.push('id', 'selector', 'repeat', 'dependsOn');
    }
    for (const command of commands) {
        if (!validCommand(command, allowedKeys)) {
            return STRICT_CATALOG_REFUSAL;
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

function validRefinement(refines: unknown): boolean {
    return (
        refines === undefined ||
        refines === null ||
        (typeof refines === 'string' && refines.length > 0 && refines.length <= PROPOSAL_REFINES_MAX_LENGTH)
    );
}

function readProposalCommands(
    args: ToolCallResult['arguments']
): { commands: unknown[]; kind: 'primitive' | 'list' } | null {
    const listItems: unknown = isRecord(args.list) ? args.list.items : undefined;
    if (Array.isArray(args.commands)) {
        if (Array.isArray(listItems)) {
            return null;
        }
        return { commands: args.commands, kind: 'primitive' };
    }
    if (!Array.isArray(listItems) || normalizeAgentPlanProposal(args.plan) === null) {
        return null;
    }
    return { commands: listItems, kind: 'list' };
}

export function validateCommandBatchProposal(
    call: ToolCallResult,
    disclosedCommandSchemas: ReadonlyMap<string, string>,
    retainedCompilations: ReadonlyMap<string, RetainedCompilation>
): string | null {
    const references = call.arguments.compiledCallIds;
    if (!validReferences(references, retainedCompilations)) {
        return 'Provider referenced an unknown, duplicate, or failed transform compilation or recipe expansion, or measured preview.';
    }
    const selectedCount =
        references?.reduce((count, callId) => count + (retainedCompilations.get(callId)?.commands.length ?? 0), 0) ?? 0;
    if (
        Object.keys(call.arguments).some((key) => !COMMAND_BATCH_PROPOSAL_KEYS.has(key)) ||
        !validRefinement(call.arguments.refines)
    ) {
        return STRICT_CATALOG_REFUSAL;
    }
    const proposal = readProposalCommands(call.arguments);
    if (!proposal) {
        return STRICT_CATALOG_REFUSAL;
    }
    const { commands, kind } = proposal;
    const hasPrimitiveCommands = kind === 'primitive';
    const commandLimit = hasPrimitiveCommands ? MAX_LLM_ACTIONS_PER_BATCH : SEMANTIC_COMMAND_LIST_MAX_ITEMS;
    if (
        commands.length + selectedCount === 0 ||
        commands.length > commandLimit ||
        commands.length + selectedCount > MAX_LLM_ACTIONS_PER_BATCH
    ) {
        return 'Provider command proposal exceeds the command budget.';
    }
    return validateCommands(commands, hasPrimitiveCommands, disclosedCommandSchemas);
}
