import { createSeededRandom } from '#/utils/SeededRandom/SeededRandom';

import {
    DECLARATIVE_TRANSFORM_BINDING_PRODUCERS,
    DECLARATIVE_TRANSFORM_MAX_EMITTED_COMMANDS,
    DECLARATIVE_TRANSFORM_MAX_SEED,
    DECLARATIVE_TRANSFORM_MAX_STEP_DEPTH,
    DECLARATIVE_TRANSFORM_MAX_VARIABLES,
    DECLARATIVE_TRANSFORM_MIN_SEED,
    DECLARATIVE_TRANSFORM_SCHEMA_VERSION,
    type CompiledTransformCommand,
    type DeclarativeTransformCompilation,
    type DeclarativeTransformDocument,
    type TransformArgument,
    type TransformExpression,
    type TransformItemBinding,
    type TransformQuantity,
    type TransformSnapshot,
    type TransformStep,
} from '../models/DeclarativeTransform';
import { evaluateTransformCondition } from '../services/declarativeTransform/evaluateTransformCondition';
import {
    evaluateTransformExpression,
    type TransformEvaluationContext,
} from '../services/declarativeTransform/evaluateTransformExpression';
import { selectTransformItems } from '../services/declarativeTransform/selectTransformItems';

import { getExecutableAppActionEffect } from './executableAppActionEffects';
import { COMMAND_APPLICATION_ID_RULES } from './materializeCommandApplicationIds';

/**
 * A binding resolves only because the producing command mints an application-owned identity the
 * batch envelope can name, so the producer list is read against the table that declares that
 * argument rather than restated.
 */
const BINDING_PRODUCER_ARGUMENTS: ReadonlyMap<string, string> = new Map(
    DECLARATIVE_TRANSFORM_BINDING_PRODUCERS.flatMap((operation) => {
        const rule = COMMAND_APPLICATION_ID_RULES[operation];
        return rule === undefined ? [] : [[operation, rule.argument] as const];
    })
);

type WalkContext = {
    document: DeclarativeTransformDocument;
    random: () => number;
    snapshot: TransformSnapshot;
};

type WalkState = {
    bindings: Map<string, string>;
    commands: CompiledTransformCommand[];
    emittedStepIds: string[];
    items: Map<string, TransformItemBinding>;
    variables: Map<string, TransformQuantity>;
};

type Failure = { reason: string };

type RenderedArguments = { dependencyStepIds: readonly string[]; values: Record<string, unknown> };

function failed(reason: string): Failure {
    return { reason };
}

function isFailure(value: object): value is Failure {
    return 'reason' in value;
}

function isExpressionArgument(argument: TransformArgument): argument is TransformExpression {
    return 'node' in argument;
}

function evaluationContext(state: WalkState, context: WalkContext, label: string): TransformEvaluationContext {
    return {
        items: state.items,
        label,
        random: context.random,
        tempo: context.snapshot.tempo,
        variables: state.variables,
    };
}

function nestedSteps(step: TransformStep): readonly TransformStep[] {
    if (step.kind === 'each') {
        return step.body;
    }
    return step.kind === 'when' ? step.then : [];
}

function collectStepIds(steps: readonly TransformStep[], seen: Set<string>): Failure | null {
    for (const step of steps) {
        if (seen.has(step.id)) {
            return failed(`step "${step.id}" is declared more than once`);
        }
        seen.add(step.id);
        const failure = collectStepIds(nestedSteps(step), seen);
        if (failure) {
            return failure;
        }
    }
    return null;
}

function evaluateDocumentVariables(context: WalkContext): Map<string, TransformQuantity> | Failure {
    const declared = Object.entries(context.document.variables);
    if (declared.length > DECLARATIVE_TRANSFORM_MAX_VARIABLES) {
        return failed(
            `variable bound: ${String(declared.length)} variables declared, above the maximum ${String(DECLARATIVE_TRANSFORM_MAX_VARIABLES)}`
        );
    }
    const variables = new Map<string, TransformQuantity>();
    const state: WalkState = {
        bindings: new Map(),
        commands: [],
        emittedStepIds: [],
        items: new Map(),
        variables,
    };
    for (const [name, expression] of declared) {
        const result = evaluateTransformExpression(expression, evaluationContext(state, context, `variable "${name}"`));
        if (result.status === 'rejected') {
            return failed(result.reason);
        }
        variables.set(name, result.quantity);
    }
    return variables;
}

function orderByWalk(stepIds: readonly string[], walkOrder: readonly string[]): readonly string[] {
    return [...new Set(stepIds)].sort((left, right) => walkOrder.indexOf(left) - walkOrder.indexOf(right));
}

function renderArgument(
    input: { argument: TransformArgument; name: string; step: Extract<TransformStep, { kind: 'emit' }> },
    state: WalkState,
    context: WalkContext
): { dependencyStepId?: string; value: unknown } | Failure {
    const { argument, name, step } = input;
    const label = `step "${step.id}" argument "${name}"`;
    if (isExpressionArgument(argument)) {
        const result = evaluateTransformExpression(argument, evaluationContext(state, context, label));
        if (result.status === 'rejected') {
            return failed(result.reason);
        }
        return { value: result.quantity.value };
    }
    if ('literal' in argument) {
        return { value: argument.literal };
    }
    if ('itemId' in argument) {
        const item = state.items.get(argument.itemId);
        if (item === undefined) {
            return failed(`unknown item "${argument.itemId}" in ${label}`);
        }
        return { value: item.id };
    }
    const producerStepId = state.bindings.get(argument.bindingRef);
    if (producerStepId === undefined) {
        return failed(`${label} reads binding "${argument.bindingRef}" before the step that produces it`);
    }
    return { dependencyStepId: producerStepId, value: `$${argument.bindingRef}` };
}

function renderArguments(
    step: Extract<TransformStep, { kind: 'emit' }>,
    state: WalkState,
    context: WalkContext
): RenderedArguments | Failure {
    const values: Record<string, unknown> = {};
    const dependencyStepIds: string[] = [];
    for (const [name, argument] of Object.entries(step.arguments)) {
        const rendered = renderArgument({ argument, name, step }, state, context);
        if (isFailure(rendered)) {
            return rendered;
        }
        values[name] = rendered.value;
        if (rendered.dependencyStepId !== undefined) {
            dependencyStepIds.push(rendered.dependencyStepId);
        }
    }
    return { dependencyStepIds, values };
}

function validateBinding(step: Extract<TransformStep, { kind: 'emit' }>, state: WalkState): Failure | null {
    if (step.binding === undefined) {
        return null;
    }
    if (!BINDING_PRODUCER_ARGUMENTS.has(step.operation)) {
        return failed(
            `step "${step.id}" may not bind "${step.binding}": ${step.operation} is not a batch-local binding producer`
        );
    }
    if (state.bindings.has(step.binding)) {
        return failed(`step "${step.id}" mints binding "${step.binding}", which an earlier step already minted`);
    }
    return null;
}

function validateDeclaredDependencies(
    step: Extract<TransformStep, { kind: 'emit' }>,
    state: WalkState
): readonly string[] | Failure {
    const declared = step.dependsOn ?? [];
    const unknown = declared.find((stepId) => !state.emittedStepIds.includes(stepId));
    if (unknown === undefined) {
        return declared;
    }
    return failed(`step "${step.id}" depends on "${unknown}", which no earlier step emitted`);
}

function emitStep(
    step: Extract<TransformStep, { kind: 'emit' }>,
    state: WalkState,
    context: WalkContext
): Failure | null {
    if (state.commands.length >= DECLARATIVE_TRANSFORM_MAX_EMITTED_COMMANDS) {
        return failed(
            `emitted command bound: step "${step.id}" emits past the maximum ${String(DECLARATIVE_TRANSFORM_MAX_EMITTED_COMMANDS)} commands`
        );
    }
    if (getExecutableAppActionEffect(step.operation) === null) {
        return failed(`step "${step.id}" names unknown operation "${step.operation}"`);
    }
    const bindingFailure = validateBinding(step, state);
    if (bindingFailure) {
        return bindingFailure;
    }
    const declared = validateDeclaredDependencies(step, state);
    if (isFailure(declared)) {
        return declared;
    }
    const rendered = renderArguments(step, state, context);
    if (isFailure(rendered)) {
        return rendered;
    }
    if (!state.emittedStepIds.includes(step.id)) {
        state.emittedStepIds.push(step.id);
    }
    state.commands.push({
        stepId: step.id,
        operation: step.operation,
        arguments: rendered.values,
        reason: `Declarative transform "${context.document.name}" step "${step.id}".`,
        expectedEffect: `${step.operation} lowered from declarative transform "${context.document.name}".`,
        binding: step.binding ?? null,
        dependencyStepIds: orderByWalk([...declared, ...rendered.dependencyStepIds], state.emittedStepIds),
    });
    if (step.binding !== undefined) {
        state.bindings.set(step.binding, step.id);
    }
    return null;
}

function walkEach(
    step: Extract<TransformStep, { kind: 'each' }>,
    state: WalkState,
    context: WalkContext,
    depth: number
): Failure | null {
    const selector = context.document.selectors[step.selector];
    if (selector === undefined) {
        return failed(`step "${step.id}" references unknown selector "${step.selector}"`);
    }
    if (state.items.has(step.as)) {
        return failed(`step "${step.id}" rebinds the item "${step.as}" an enclosing step already bound`);
    }
    const selection = selectTransformItems(selector, context.snapshot, `step "${step.id}" selector "${step.selector}"`);
    if (selection.status === 'rejected') {
        return failed(selection.reason);
    }
    for (const item of selection.items) {
        state.items.set(step.as, item);
        const failure = walkSteps(step.body, state, context, depth + 1);
        if (failure) {
            state.items.delete(step.as);
            return failure;
        }
    }
    state.items.delete(step.as);
    return null;
}

function walkWhen(
    step: Extract<TransformStep, { kind: 'when' }>,
    state: WalkState,
    context: WalkContext,
    depth: number
): Failure | null {
    const result = evaluateTransformCondition(step.condition, evaluationContext(state, context, `step "${step.id}"`));
    if (result.status === 'rejected') {
        return failed(result.reason);
    }
    if (!result.value) {
        return null;
    }
    return walkSteps(step.then, state, context, depth + 1);
}

function walkStep(step: TransformStep, state: WalkState, context: WalkContext, depth: number): Failure | null {
    if (step.kind === 'each') {
        return walkEach(step, state, context, depth);
    }
    if (step.kind === 'when') {
        return walkWhen(step, state, context, depth);
    }
    return emitStep(step, state, context);
}

function walkSteps(
    steps: readonly TransformStep[],
    state: WalkState,
    context: WalkContext,
    depth: number
): Failure | null {
    if (depth > DECLARATIVE_TRANSFORM_MAX_STEP_DEPTH) {
        return failed(`step depth above the maximum ${String(DECLARATIVE_TRANSFORM_MAX_STEP_DEPTH)}`);
    }
    for (const step of steps) {
        const failure = walkStep(step, state, context, depth);
        if (failure) {
            return failure;
        }
    }
    return null;
}

function checkAssertions(state: WalkState, context: WalkContext): Failure | null {
    for (const assertion of context.document.assertions) {
        const result = evaluateTransformCondition(
            assertion.condition,
            evaluationContext(state, context, `assertion "${assertion.message}"`)
        );
        if (result.status === 'rejected') {
            return failed(result.reason);
        }
        if (!result.value) {
            return failed(assertion.message);
        }
    }
    return null;
}

function checkDocumentHeader(document: DeclarativeTransformDocument): Failure | null {
    if (document.schemaVersion !== DECLARATIVE_TRANSFORM_SCHEMA_VERSION) {
        return failed(
            `unsupported schema version ${String(document.schemaVersion)}; this compiler reads version ${String(DECLARATIVE_TRANSFORM_SCHEMA_VERSION)}`
        );
    }
    const seedInRange =
        Number.isInteger(document.seed) &&
        document.seed >= DECLARATIVE_TRANSFORM_MIN_SEED &&
        document.seed <= DECLARATIVE_TRANSFORM_MAX_SEED;
    if (!seedInRange) {
        return failed(
            `seed ${String(document.seed)} is outside ${String(DECLARATIVE_TRANSFORM_MIN_SEED)} to ${String(DECLARATIVE_TRANSFORM_MAX_SEED)}`
        );
    }
    return null;
}

/**
 * Lowers one declarative transform document into ordinary commands against an immutable snapshot,
 * or says which variable or step refused it. Nothing new executes and nothing is read outside the
 * arguments: the only randomness is the document's own seed, so two compilations of the same
 * document and snapshot produce the same commands.
 */
export function compileDeclarativeTransform(
    document: DeclarativeTransformDocument,
    snapshot: TransformSnapshot
): DeclarativeTransformCompilation {
    const headerFailure = checkDocumentHeader(document);
    if (headerFailure) {
        return { status: 'rejected', reason: headerFailure.reason };
    }
    const duplicateStep = collectStepIds(document.steps, new Set());
    if (duplicateStep) {
        return { status: 'rejected', reason: duplicateStep.reason };
    }
    const context: WalkContext = { document, random: createSeededRandom(document.seed), snapshot };
    const variables = evaluateDocumentVariables(context);
    if (isFailure(variables)) {
        return { status: 'rejected', reason: variables.reason };
    }
    const state: WalkState = {
        bindings: new Map(),
        commands: [],
        emittedStepIds: [],
        items: new Map(),
        variables,
    };
    const walkFailure = walkSteps(document.steps, state, context, 1);
    if (walkFailure) {
        return { status: 'rejected', reason: walkFailure.reason };
    }
    const assertionFailure = checkAssertions(state, context);
    if (assertionFailure) {
        return { status: 'rejected', reason: assertionFailure.reason };
    }
    return { status: 'compiled', commands: state.commands };
}
