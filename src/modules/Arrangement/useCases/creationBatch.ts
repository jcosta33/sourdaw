import { type executeAppActionBatch } from '#/modules/Command/useCases';

export type CreationBatchAction = Parameters<typeof executeAppActionBatch>[0][number];
export type CreationBatchResult = Awaited<ReturnType<typeof executeAppActionBatch>>;

/**
 * The batch statuses that leave the created media in the project; everything
 * else (refusal, cancellation, rollback) releases the caller's audio assets.
 */
export function retainedCreation(result: CreationBatchResult | null): boolean {
    return (
        result !== null &&
        (result.status === 'committed' || result.status === 'committed-with-warning' || result.status === 'ambiguous')
    );
}
