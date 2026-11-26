import { describe, expect, it } from 'vitest';

import { COMMAND_BATCH_IDEMPOTENCY_REGISTRAR } from '../../testing/registerInMemoryCommandBatchIdempotency';
import { commandBatchExecutionAuthorityPort } from '../commandBatchExecutionAuthorityPort';

const canExecute = () => true;

// Vitest gives each spec file a fresh module graph, so the cases below run in
// order: the unfilled read first, then the fill.
describe('commandBatchExecutionAuthorityPort', () => {
    it('throws on a read before registration, naming the registrar', () => {
        expect(() => commandBatchExecutionAuthorityPort.canExecute()).toThrow(COMMAND_BATCH_IDEMPOTENCY_REGISTRAR);
    });

    it('serves the registered provider', () => {
        commandBatchExecutionAuthorityPort.setProvider(canExecute);
        expect(commandBatchExecutionAuthorityPort.canExecute()).toBe(true);
    });

    it('answers from the second provider after a second fill', () => {
        commandBatchExecutionAuthorityPort.setProvider(() => false);

        expect(commandBatchExecutionAuthorityPort.canExecute()).toBe(false);
    });
});
