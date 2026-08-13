import { createLocalStorageCommandBatchIdempotencyRepository } from '../repositories/createLocalStorageCommandBatchIdempotencyRepository';

import { commandBatchExecutionAuthorityPort } from './commandBatchExecutionAuthorityPort';
import { commandBatchIdempotencyPort } from './commandBatchIdempotencyPort';

type ConfigureCommandBatchIdempotencyInput = {
    canExecute: () => boolean;
};

export function configureCommandBatchIdempotency(input: ConfigureCommandBatchIdempotencyInput): void {
    commandBatchIdempotencyPort.setRepository(createLocalStorageCommandBatchIdempotencyRepository());
    commandBatchExecutionAuthorityPort.setProvider(input.canExecute);
}
