import { type CommandApplicationAssignedId } from '../models/VersionedCommandEnvelope';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringId(source: unknown, field: string, argument: string): CommandApplicationAssignedId[] {
    if (!isRecord(source)) {
        return [];
    }
    const value = source[field];
    return typeof value === 'string' && value !== '' ? [{ argument, value }] : [];
}

/** The `field` id of each record in `source[list]`, named by its `prefix`ed argument path. */
function readListedIds(source: unknown, prefix: string, list: string, field: string): CommandApplicationAssignedId[] {
    if (!isRecord(source)) {
        return [];
    }
    const entries = source[list];
    if (!Array.isArray(entries)) {
        return [];
    }
    return entries.flatMap((entry: unknown, index) =>
        readStringId(entry, field, `${prefix}${list}[${String(index)}].${field}`)
    );
}

type CommandArguments = Readonly<Record<string, unknown>>;

type HandlerMintedIdReader = (argumentsValue: CommandArguments) => CommandApplicationAssignedId[];

/**
 * Commands whose arguments are derived from project state when they compile, so the ids they
 * create cannot be drawn before the handler or the state guards run: how many lanes a glue migrates
 * or segments a strip cuts is only known from the project. Each reader names, in the compiled
 * arguments, every id drawn for a project entity the command creates. A render job is not one: the
 * receipt links it under `links.render`, and the batch digest reads those ids itself.
 */
const HANDLER_MINTED_ID_READERS: ReadonlyMap<string, HandlerMintedIdReader> = new Map([
    [
        'glueClips',
        (argumentsValue) => [
            ...readStringId(argumentsValue, 'targetClipId', 'targetClipId'),
            ...readListedIds(argumentsValue.replacement, 'replacement.', 'clipAutomationLanes', 'id'),
        ],
    ],
    [
        'stripSilence',
        (argumentsValue) => [
            ...readListedIds(argumentsValue.replacement, 'replacement.', 'clips', 'id'),
            ...readListedIds(argumentsValue.replacement, 'replacement.', 'clipAutomationLanes', 'id'),
        ],
    ],
    ['arpeggiate', (argumentsValue) => readListedIds(argumentsValue, '', 'addedNotes', 'id')],
]);

/**
 * Every id drawn for the objects a command creates after `materializeCommandApplicationIds` has
 * run, read from the arguments the command compiled. The record of assigned ids names them beside
 * the ones that materialization drew, so a hash that stands minted ids as ordinals reaches them.
 */
export function readHandlerMintedApplicationIds(
    operation: string,
    argumentsValue: CommandArguments
): CommandApplicationAssignedId[] {
    return HANDLER_MINTED_ID_READERS.get(operation)?.(argumentsValue) ?? [];
}
