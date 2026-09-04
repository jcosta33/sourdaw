import { commandBatchExecutionAuthorityPort } from './commandBatchExecutionAuthorityPort';
import { commandBatchIdempotencyPort } from './commandBatchIdempotencyPort';

export function resetCommandBatchIdempotency(): void {
    commandBatchIdempotencyPort.setRepository(null);
    commandBatchExecutionAuthorityPort.setProvider(null);
}
