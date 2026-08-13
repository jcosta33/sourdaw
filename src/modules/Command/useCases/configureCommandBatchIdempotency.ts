import { createLocalStorageCommandBatchIdempotencyRepository } from '../repositories/createLocalStorageCommandBatchIdempotencyRepository';

import { commandBatchIdempotencyPort } from './commandBatchIdempotencyPort';

export function configureCommandBatchIdempotency(): void {
    commandBatchIdempotencyPort.setRepository(createLocalStorageCommandBatchIdempotencyRepository());
}
