import { type parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { digest } from '#/utils/canonicalDigest';

type CommandBatchEnvelope = Extract<
    ReturnType<typeof parseVersionedCommandBatchEnvelope>,
    { status: 'valid' }
>['envelope'];

/**
 * The content hash of what a batch does: each command's operation and arguments, in order. The
 * batch's own identity, revision and command ids are left out, so a batch re-anchored to a newer
 * revision with the same commands keeps its hash, while a subset or a changed command does not.
 */
export function digestCommandBatchContent(envelope: CommandBatchEnvelope): string {
    return digest(envelope.commands.map((command) => ({ operation: command.operation, arguments: command.arguments })));
}
