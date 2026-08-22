type ProviderPlanCall = { name: string; arguments: Record<string, unknown> };

type ProviderScope = {
    targetIds: string[];
    targetRanges: Array<{ startBeat: number; endBeat: number }>;
    protectedTargetIds: string[];
    protectedRanges: Array<{ startBeat: number; endBeat: number }>;
};

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
                    plan: {
                        semantic: { classification: 'simple', uncertainty: [] },
                        objective: 'Execute the grounded command batch.',
                        constraints: [],
                        scope,
                        capabilityIds: commandNames,
                        assetIds: [],
                        alternatives: [],
                        validationStrategy: ['Validate the grounded command batch.'],
                        stoppingConditions: ['Stop if application validation fails.'],
                    },
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
