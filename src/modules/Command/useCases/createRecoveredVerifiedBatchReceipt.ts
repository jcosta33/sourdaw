import { type AppAction } from '#/utils/handlerContract';

import { type VersionedCommandBatchEnvelope } from '../models/VersionedCommandBatchEnvelope';

import { createVerifiedBatchReceipt } from './createVerifiedBatchReceipt';
import { createVersionedCommandReceipt } from './createVersionedCommandReceipt';

type VerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;

export function createRecoveredVerifiedBatchReceipt(input: {
    envelope: VersionedCommandBatchEnvelope;
    priorReceipt: VerifiedBatchReceipt;
    receiptWarnings: readonly string[];
}): VerifiedBatchReceipt {
    const priorOutcomes = new Map(input.priorReceipt.commandOutcomes.map((outcome) => [outcome.commandId, outcome]));
    const actions = input.envelope.commands.flatMap((command) => {
        const priorOutcome = priorOutcomes.get(command.commandId);
        if (priorOutcome?.outcome !== 'committed') {
            return [];
        }
        return [
            {
                action: { type: command.operation, payload: command.arguments } as AppAction,
                receipt: createVersionedCommandReceipt({
                    envelope: command,
                    compensation: {
                        available: priorOutcome.compensationAvailable,
                        strategy: priorOutcome.compensationAvailable ? 'inverse' : 'none',
                    },
                }),
            },
        ];
    });
    const recovered = createVerifiedBatchReceipt({
        envelope: input.envelope,
        observedBaseRevision: input.priorReceipt.observedBase?.normalizedRevision ?? null,
        receiptWarnings: input.receiptWarnings,
        resultingRevision: input.priorReceipt.resulting?.normalizedRevision ?? null,
        result: { status: 'committed', actions },
    });
    return {
        ...recovered,
        atomicity: input.priorReceipt.atomicity,
        modelSummary: `${recovered.modelSummary} Pending external effects were reconciled successfully.`,
    };
}
