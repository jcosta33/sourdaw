import { type parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { digest } from '#/utils/canonicalDigest';

type CommandBatchEnvelope = Extract<
    ReturnType<typeof parseVersionedCommandBatchEnvelope>,
    { status: 'valid' }
>['envelope'];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every id the batch mints for an object it creates: the ids the application assigned each command
 * and the value each batch-local binding's producer carries. Each compilation draws them afresh.
 */
function readMintedIds(envelope: CommandBatchEnvelope): ReadonlySet<string> {
    const minted = new Set(
        envelope.commands.flatMap((command) => command.applicationAssignedIds.map(({ value }) => value))
    );
    for (const binding of envelope.batchLocalBindings) {
        const producer = envelope.commands.find((command) => command.commandId === binding.producerCommandId);
        const value = producer?.arguments[binding.producerArgument];
        if (typeof value === 'string') {
            minted.add(value);
        }
    }
    return minted;
}

/** The commands whose display color the application draws from a session palette when the batch compiles. */
const PALETTE_COLORED_OPERATIONS: ReadonlySet<string> = new Set(['addTrack', 'createBus']);

/**
 * A command's arguments without the display color a new track or bus draws from the session
 * palette: every compilation draws the next one, and a color changes nothing anyone hears.
 */
function withoutApplicationColor(command: CommandBatchEnvelope['commands'][number]): unknown {
    if (!PALETTE_COLORED_OPERATIONS.has(command.operation)) {
        return command.arguments;
    }
    return Object.fromEntries(Object.entries(command.arguments).filter(([key]) => key !== 'color'));
}

/** `value` with each minted id replaced by its order of first appearance, keys visited in sorted order. */
function normalizeMintedIds(value: unknown, minted: ReadonlySet<string>, ordinals: Map<string, string>): unknown {
    if (typeof value === 'string') {
        if (!minted.has(value)) {
            return value;
        }
        const ordinal = ordinals.get(value) ?? `$minted-${String(ordinals.size)}`;
        ordinals.set(value, ordinal);
        return ordinal;
    }
    if (Array.isArray(value)) {
        return value.map((entry: unknown) => normalizeMintedIds(entry, minted, ordinals));
    }
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.keys(value)
                .toSorted()
                .map((key) => [key, normalizeMintedIds(value[key], minted, ordinals)])
        );
    }
    return value;
}

/**
 * The content hash of what a batch does: each command's operation and arguments, in order. The
 * batch's own identity, revision and command ids are left out, and the ids it mints for the
 * objects it creates stand as their order of first appearance, because two compilations of one
 * proposal draw different ids for the same objects. A batch re-anchored to a newer revision or
 * compiled again keeps its hash; a subset or a changed command does not.
 */
export function digestCommandBatchContent(envelope: CommandBatchEnvelope): string {
    const minted = readMintedIds(envelope);
    const ordinals = new Map<string, string>();
    const commands = envelope.commands.map((command) => ({
        operation: command.operation,
        arguments: normalizeMintedIds(withoutApplicationColor(command), minted, ordinals),
    }));
    return digest({ commands, bindings: readBindingWiring(envelope) });
}

/**
 * Which command and argument produce each batch-local binding. The producer stands as its position
 * in the batch, since command ids are drawn afresh by every compilation; two batches whose commands
 * agree but whose bindings resolve to different producers do different things.
 */
function readBindingWiring(envelope: CommandBatchEnvelope) {
    return envelope.batchLocalBindings.map((binding) => ({
        bindingId: binding.bindingId,
        producer: envelope.commands.findIndex((command) => command.commandId === binding.producerCommandId),
        producerArgument: binding.producerArgument,
    }));
}
