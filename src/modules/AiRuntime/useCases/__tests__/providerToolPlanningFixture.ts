type ProviderPlanCall = { name: string; arguments: Record<string, unknown> };

type ProviderScope = {
    targetIds: string[];
    targetRanges: Array<{ startBeat: number; endBeat: number }>;
    protectedTargetIds: string[];
    protectedRanges: Array<{ startBeat: number; endBeat: number }>;
};

type SemanticCommandListItem = {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    selector?: Record<string, unknown>;
    repeat?: Record<string, unknown>;
    dependsOn?: string[];
};

function createPlanProposal(scope: ProviderScope, capabilityIds: string[]) {
    return {
        semantic: { classification: 'simple', uncertainty: [] },
        objective: 'Execute the grounded command batch.',
        constraints: [],
        scope,
        capabilityIds,
        assetIds: [],
        alternatives: [],
        validationStrategy: ['Validate the grounded command batch.'],
        stoppingConditions: ['Stop if application validation fails.'],
    };
}

export function createProviderToolPlanningFixture(
    plan: readonly ProviderPlanCall[],
    scope: ProviderScope = { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] }
): () => string {
    const commandCalls = plan.filter((call) => call.name !== 'selectWorkflowCapability');
    const commandNames = [...new Set(commandCalls.map((call) => call.name))];
    if (commandNames.length !== commandCalls.length) {
        throw new Error('Repeated commands require an explicit workflow fixture with bounded semantic selectors.');
    }
    let turn = 0;
    return () => {
        turn += 1;
        if (turn === 1) {
            return JSON.stringify([
                { name: 'agent.catalog.discover', arguments: { category: 'command', names: commandNames } },
            ]);
        }
        return JSON.stringify([
            ...plan.filter((call) => call.name === 'selectWorkflowCapability'),
            {
                name: 'command.batch.propose',
                arguments: {
                    commands: commandCalls,
                    plan: createPlanProposal(scope, commandNames),
                },
            },
        ]);
    };
}

export function createProviderSemanticListPlanningFixture(
    items: readonly SemanticCommandListItem[],
    scope: ProviderScope,
    workflowCapabilityId?: string
): () => string {
    const respond = createProviderSemanticListPlanningResponder(items, scope, workflowCapabilityId);
    let turn = 0;
    return () => respond(turn++ === 0 ? '' : 'Application-owned tool receipts from turn 1');
}

/**
 * Returns catalog discovery for each new planning attempt and the semantic list only after that
 * attempt records its catalog receipt. This prevents a provider retry from inheriting a prior
 * attempt's fixture turn while retaining the real catalog contract.
 */
export function createProviderSemanticListPlanningResponder(
    items: readonly SemanticCommandListItem[],
    scope: ProviderScope,
    workflowCapabilityId?: string
): (userMessage: string) => string {
    const commandNames = [...new Set(items.map((item) => item.name))];
    return (userMessage) => {
        if (!userMessage.includes('Application-owned tool receipts from turn 1')) {
            return JSON.stringify([
                { name: 'agent.catalog.discover', arguments: { category: 'command', names: commandNames } },
            ]);
        }
        return JSON.stringify([
            ...(workflowCapabilityId === undefined
                ? []
                : [{ name: 'selectWorkflowCapability', arguments: { capabilityId: workflowCapabilityId } }]),
            {
                name: 'command.batch.propose',
                arguments: {
                    list: { schemaVersion: 1, items },
                    plan: createPlanProposal(scope, commandNames),
                },
            },
        ]);
    };
}

export function createHostedToolPlanningFixture(
    plan: readonly ProviderPlanCall[],
    scope?: ProviderScope
): () => Response {
    const next = createProviderToolPlanningFixture(plan, scope);
    return () => {
        const calls = JSON.parse(next()) as ProviderPlanCall[];
        return new Response(
            JSON.stringify({
                choices: [
                    {
                        finish_reason: 'tool_calls',
                        message: {
                            tool_calls: calls.map((call) => ({
                                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                            })),
                        },
                    },
                ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    };
}

export function createHostedSemanticListPlanningFixture(
    items: readonly SemanticCommandListItem[],
    scope: ProviderScope,
    workflowCapabilityId?: string
): () => Response {
    const next = createProviderSemanticListPlanningFixture(items, scope, workflowCapabilityId);
    return createHostedFixture(next);
}

export function createHostedSemanticListPlanningResponder(
    items: readonly SemanticCommandListItem[],
    scope: ProviderScope,
    workflowCapabilityId?: string
): (userMessage: string) => Response {
    const respond = createProviderSemanticListPlanningResponder(items, scope, workflowCapabilityId);
    return (userMessage) => createHostedFixture(() => respond(userMessage))();
}

function createHostedFixture(next: () => string): () => Response {
    return () => {
        const calls = JSON.parse(next()) as ProviderPlanCall[];
        return new Response(
            JSON.stringify({
                choices: [
                    {
                        finish_reason: 'tool_calls',
                        message: {
                            tool_calls: calls.map((call) => ({
                                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                            })),
                        },
                    },
                ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    };
}
