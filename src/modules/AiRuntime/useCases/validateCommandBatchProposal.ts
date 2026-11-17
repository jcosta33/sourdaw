import { MAX_LLM_ACTIONS_PER_BATCH } from '../models/LlmActionLimits';
import { type RetainedCompilation } from '../models/RetainedCompilation';
import { SEMANTIC_COMMAND_LIST_MAX_ITEMS } from '../models/SemanticCommandList';
import { PROPOSAL_REFINES_MAX_LENGTH } from '../models/ThreadContext';
import { normalizeAgentPlanProposal } from '../transformers/normalizeAgentPlanProposal';
import { type ToolCallResult } from '../transformers/toolCallParser';

import { getAgentToolCatalogEntries } from './getAgentToolCatalogEntries';

const MAX_CALL_ID_LENGTH = 256;

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

function validateCommands(
    commands: unknown[],
    hasPrimitiveCommands: boolean,
    disclosedCommandSchemas: ReadonlyMap<string, string>
): string | null {
    for (const command of commands) {
        if (!isRecord(command)) {
            return 'Provider command proposal does not match the strict catalog contract.';
        }
        const allowedKeys = ['name', 'arguments'];
        if (!hasPrimitiveCommands) {
            allowedKeys.push('id', 'selector', 'repeat', 'dependsOn');
        }
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

export function validateCommandBatchProposal(
    call: ToolCallResult,
    disclosedCommandSchemas: ReadonlyMap<string, string>,
    retainedCompilations: ReadonlyMap<string, RetainedCompilation>
): string | null {
    const hasPrimitiveCommands = Array.isArray(call.arguments.commands);
    const list = isRecord(call.arguments.list) ? call.arguments.list : null;
    const hasStructuredList = list !== null && Array.isArray(list.items);
    const references = call.arguments.compiledCallIds;
    if (!validReferences(references, retainedCompilations)) {
        return 'Provider referenced an unknown, duplicate, or failed transform compilation or recipe expansion, or measured preview.';
    }
    let selectedCount = 0;
    if (references !== undefined) {
        selectedCount = references.reduce(
            (count, callId) => count + (retainedCompilations.get(callId)?.commands.length ?? 0),
            0
        );
    }
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
    return validateCommands(commands, hasPrimitiveCommands, disclosedCommandSchemas);
}
