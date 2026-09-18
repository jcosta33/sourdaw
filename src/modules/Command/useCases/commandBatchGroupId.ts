import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

/** One intent group is one command; the approval view and partial acceptance must agree on that identity. */
export function commandBatchGroupId(command: VersionedCommandEnvelope): string {
    return command.commandId;
}
