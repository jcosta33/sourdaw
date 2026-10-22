import { type ProjectContext } from '../../models/ProjectContext';
import { readStoredCommandObjects, type ReadCommandRemoval } from '../../validators/admitProposalRefinement';

import { escapeRegExp } from './groundingStrategies/escapeRegExp';
import { normalizePromptText } from './groundingStrategies/normalizePromptText';
import { proposalCommandShape } from './proposalCommandShape';
import { refinementRequestReading, type ReferenceCandidate } from './refinementRequestReading';

type Command = Parameters<ReadCommandRemoval>[0]['command'];
type RemovalReading = ReturnType<ReadCommandRemoval>;

/** A name the request may state beside the project's own: a pending target id, or a pending creation's name. */
type ExtraName = { name: string; id: string };

type Mention = { id: string | null; start: number; end: number };

type Directive = { start: number; end: number; intention: 'remove' | 'preserve' };

type ClauseReading = { text: string; mentions: Mention[]; directives: Directive[] };

type MentionIntention = { clause: ClauseReading; mention: Mention; intention: 'remove' | 'preserve' };

type PendingCreation = { command: Command; names: readonly string[]; hostIds: readonly string[] };

const PRESERVE_VERBS: readonly string[] = ['keep', 'retain', 'preserve', 'leave'];
const REMOVAL_VERBS: ReadonlySet<string> = new Set(refinementRequestReading.removalVerbs);
// The removal verbs come first, so "leave out" is read as one removal verb before "leave" alone.
const DIRECTIVE = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${[...refinementRequestReading.removalVerbs, ...PRESERVE_VERBS]
        .map((phrase) => phrase.split(' ').map(escapeRegExp).join('\\s+'))
        .join('|')})(?![\\p{L}\\p{N}])`,
    'giu'
);
const BINDING_WORDS: ReadonlySet<string> = new Set([
    'the',
    'new',
    'its',
    'pending',
    'proposed',
    'command',
    'change',
    'track',
    'clip',
    'pan',
    'panning',
    'mute',
    'gain',
    'fader',
    'level',
    'from',
    'of',
    'on',
    'for',
]);
const ARTICLE_WORDS: ReadonlySet<string> = new Set(refinementRequestReading.articles);
const OPERATION_WORDS: ReadonlySet<string> = new Set(refinementRequestReading.operationWords);

function operationPattern(actionType: string): RegExp | null {
    if (actionType === 'setTrackPan') {
        return /\bpan(?:ning)?\b/i;
    }
    if (actionType === 'setTrackGain') {
        return /\b(?:gain|fader|level)\b/i;
    }
    if (actionType === 'muteTrack') {
        return /\bmute\b/i;
    }
    const operation = actionType
        .match(/[A-Z][a-z]+|^[a-z]+/g)
        ?.at(-1)
        ?.toLowerCase();
    return operation === undefined ? null : new RegExp(`\\b${operation}\\b`, 'i');
}

function quotedRanges(text: string): Array<{ start: number; end: number; contentEnd: number; complete: boolean }> {
    const ranges: Array<{ start: number; end: number; contentEnd: number; complete: boolean }> = [];
    let opened: { start: number; close: string } | null = null;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (opened !== null) {
            if (character === opened.close) {
                ranges.push({ start: opened.start, end: index + 1, contentEnd: index, complete: true });
                opened = null;
            }
            continue;
        }
        if (character !== '"' && character !== "'" && character !== '“' && character !== '‘') {
            continue;
        }
        if (
            character === "'" &&
            /[\p{L}\p{N}]/u.test(text[index - 1] ?? '') &&
            /[\p{L}\p{N}]/u.test(text[index + 1] ?? '')
        ) {
            continue;
        }
        let close = character;
        if (character === '“') {
            close = '”';
        } else if (character === '‘') {
            close = '’';
        }
        opened = { start: index, close };
    }
    if (opened !== null) {
        ranges.push({ start: opened.start, end: text.length, contentEnd: text.length, complete: false });
    }
    return ranges;
}

function createdNameId(name: string): string {
    return `created:${normalizePromptText(name)}`;
}

/**
 * Every name the request is read against, longest first: every project object's, by the reader's own
 * candidates, beside the pending target ids and creation names. A name that is itself a binding word
 * ("gain", "pan") is read as that word, never as an object.
 */
function readCandidates(context: ProjectContext, extra: readonly ExtraName[]): ReferenceCandidate[] {
    const byName = new Map<string, Set<string>>(
        refinementRequestReading.candidates(context).map((candidate) => [candidate.name, new Set(candidate.denotes)])
    );
    for (const { name, id } of extra) {
        const normalized = normalizePromptText(name);
        const key = normalized.length > 0 ? normalized : name.trim();
        if (key.length === 0) {
            continue;
        }
        const ids = byName.get(key) ?? new Set<string>();
        ids.add(id);
        byName.set(key, ids);
    }
    return Array.from(byName, ([name, denotes]) => ({ name, denotes }))
        .filter((candidate) => !BINDING_WORDS.has(candidate.name))
        .sort((left, right) => right.name.length - left.name.length);
}

/** Each object's raw spellings, lowercased, so a name two objects share once normalized still tells them apart. */
function readSpellings(context: ProjectContext, extra: readonly ExtraName[]): Map<string, Set<string>> {
    const spellings = new Map<string, Set<string>>();
    const add = (raw: string | undefined, id: string) => {
        const key = (raw ?? '').trim().toLowerCase();
        if (key.length === 0) {
            return;
        }
        const ids = spellings.get(key) ?? new Set<string>();
        ids.add(id);
        spellings.set(key, ids);
    };
    for (const group of context.vcaGroups ?? []) {
        add(group.id, group.id);
        add(group.name, group.id);
    }
    for (const track of context.tracks) {
        add(track.id, track.id);
        add(track.name, track.id);
        for (const device of track.devices) {
            add(device.id, device.id);
            add(device.type, device.id);
            add(device.name, device.id);
            for (const parameter of device.parameters ?? []) {
                add(parameter.id, `${device.id}:${parameter.id}`);
                add(parameter.name, `${device.id}:${parameter.id}`);
            }
        }
        for (const clip of track.clips) {
            add(clip.id, clip.id);
            add(clip.name, clip.id);
        }
    }
    for (const { name, id } of extra) {
        add(name, id);
    }
    return spellings;
}

/** The one object a mention names: the only one its name denotes, or the only one spelled exactly as stated. */
function readMentionedId(
    denotes: ReadonlySet<string>,
    stated: string,
    spellings: ReadonlyMap<string, ReadonlySet<string>>
): string | null {
    const ids = Array.from(denotes);
    const spelled = spellings.get(stated.trim().toLowerCase());
    const narrowed = ids.length > 1 ? ids.filter((id) => spelled?.has(id) === true) : ids;
    return narrowed.length === 1 ? narrowed[0]! : null;
}

/**
 * The whole-name mentions a clause states, read longest name first. A name inside quotation marks
 * counts only when it is the whole quoted text, and then binds the quotation as a whole.
 */
function readMentions(
    text: string,
    candidates: readonly ReferenceCandidate[],
    spellings: ReadonlyMap<string, ReadonlySet<string>>
): Mention[] {
    const quotes = quotedRanges(text);
    return refinementRequestReading.references(text, candidates).flatMap((reference) => {
        const quote = quotes.find((range) => reference.start < range.end && reference.end > range.start);
        if (
            quote !== undefined &&
            (!quote.complete || reference.start !== quote.start + 1 || reference.end !== quote.contentEnd)
        ) {
            return [];
        }
        return [
            {
                id: readMentionedId(reference.denotes, text.slice(reference.start, reference.end), spellings),
                start: quote?.start ?? reference.start,
                end: quote?.end ?? reference.end,
            },
        ];
    });
}

/**
 * Whether a clause is a bare object name and nothing else: one mention, after nothing but articles and
 * before at most one operation word ("the vocal gain"). Only such a clause continues a removal, so a
 * clause saying anything of the object ("the Vocals gain stays", "vocals fader up") never removes it.
 */
function isBareObjectClause(text: string, mentions: readonly Mention[]): boolean {
    const [only] = mentions;
    if (only === undefined || mentions.length !== 1) {
        return false;
    }
    const wordsOf = (part: string) =>
        normalizePromptText(part)
            .split(' ')
            .filter((word) => word.length > 0);
    const after = wordsOf(text.slice(only.end));
    return (
        wordsOf(text.slice(0, only.start)).every((word) => ARTICLE_WORDS.has(word)) &&
        after.length <= 1 &&
        after.every((word) => OPERATION_WORDS.has(word))
    );
}

/**
 * Whether nothing but binding words and other object names follows a removal's object and its operation
 * word to the end of the clause. Any other word after them ("drop the snare gain a bit") says something
 * of the object a removal does not, so the clause keeps it rather than removing it.
 */
function endsAtObject(clause: Pick<ClauseReading, 'text' | 'mentions'>, from: number): boolean {
    let rest = '';
    let cursor = from;
    for (const mention of clause.mentions) {
        if (mention.end <= cursor) {
            continue;
        }
        rest += ` ${clause.text.slice(cursor, Math.max(cursor, mention.start))}`;
        cursor = mention.end;
    }
    rest += ` ${clause.text.slice(cursor)}`;
    return normalizePromptText(rest)
        .split(' ')
        .every((word) => word.length === 0 || BINDING_WORDS.has(word) || OPERATION_WORDS.has(word));
}

/**
 * The directives a clause states, outside quotation marks. A removal verb removes only when nothing but
 * the shared openers stand before it, and in a clause stating a figure it changes a level, so it is no
 * directive at all ("drop the Vocals gain to -1 dB"). A bare object name right after a removal
 * continues it ("remove the guitar pan and the vocal gain").
 */
function readDirectives(clause: { text: string; masked: string }, continuesRemoval: boolean): Directive[] {
    const quotes = quotedRanges(clause.text);
    const changesLevel = refinementRequestReading.statesFigure(clause);
    const directives = Array.from(clause.text.matchAll(DIRECTIVE)).flatMap((match): Directive[] => {
        const start = match.index;
        if (quotes.some((quote) => start >= quote.start && start < quote.end)) {
            return [];
        }
        const isRemovalVerb = REMOVAL_VERBS.has(normalizePromptText(match[0]));
        if (isRemovalVerb && changesLevel) {
            return [];
        }
        const opens = isRemovalVerb && refinementRequestReading.opensRemoval(clause.text.slice(0, start));
        return [{ start, end: start + match[0].length, intention: opens ? 'remove' : 'preserve' }];
    });
    if (directives.length === 0 && continuesRemoval && !changesLevel) {
        return [{ start: 0, end: 0, intention: 'remove' }];
    }
    return directives;
}

/** The request's clauses, cut by the shared clause splitter, each with its mentions and directives. */
function readRequest(prompt: string, context: ProjectContext, extra: readonly ExtraName[]): ClauseReading[] {
    const candidates = readCandidates(context, extra);
    const spellings = readSpellings(context, extra);
    let continuesRemoval = false;
    return refinementRequestReading.clauses(prompt, context).map((clause) => {
        const mentions = readMentions(clause.text, candidates, spellings);
        const directives = readDirectives(clause, continuesRemoval && isBareObjectClause(clause.text, mentions));
        const lastMention = mentions.at(-1);
        continuesRemoval =
            directives.some((directive) => directive.intention === 'remove') &&
            lastMention !== undefined &&
            endsAtObject({ text: clause.text, mentions }, lastMention.end);
        return { text: clause.text, mentions, directives };
    });
}

function onlyBindingWords(text: string): boolean {
    return (
        text === '' ||
        text
            .toLowerCase()
            .split(/\s+/)
            .every((word) => BINDING_WORDS.has(word))
    );
}

function intentionForMention(input: {
    clause: ClauseReading;
    index: number;
    /** The word the operation is named by, or `null` when the mention names the whole change, as a created object's name does. */
    operation: RegExp | null;
}): 'remove' | 'preserve' | null {
    const { clause, index, operation } = input;
    const { text, mentions, directives } = clause;
    const mention = mentions[index]!;
    const previousEnd = mentions[index - 1]?.end ?? 0;
    const directive = directives.findLast((entry) => entry.start >= previousEnd && entry.end <= mention.start);
    if (!directive) {
        return null;
    }
    const beforeTarget = text.slice(directive.end, mention.start).trim();
    if (!onlyBindingWords(beforeTarget)) {
        return null;
    }
    if (operation === null) {
        return settleIntention(directive.intention, clause, mention.end);
    }
    const nextDirective = directives.find((entry) => entry.start > mention.end)?.start;
    const nextTarget = mentions[index + 1]?.start;
    const end = Math.min(nextDirective ?? text.length, nextTarget ?? text.length);
    const afterTarget = text.slice(mention.end, end);
    const afterMatch = operation.exec(afterTarget);
    const beforeOperation = afterMatch === null ? '' : afterTarget.slice(0, afterMatch.index).trim();
    if (
        (afterMatch !== null && !onlyBindingWords(beforeOperation)) ||
        (!operation.test(beforeTarget) && afterMatch === null)
    ) {
        return null;
    }
    const objectEnd = afterMatch === null ? mention.end : mention.end + afterMatch.index + afterMatch[0].length;
    return settleIntention(directive.intention, clause, objectEnd);
}

/** A removal stands only when nothing follows its object and operation word; otherwise the clause keeps it. */
function settleIntention(
    intention: Directive['intention'],
    clause: ClauseReading,
    objectEnd: number
): Directive['intention'] {
    return intention === 'remove' && !endsAtObject(clause, objectEnd) ? 'preserve' : intention;
}

/** Each mention of this id a directive governs, by clause, with what the directive asks of it. */
function readMentionIntentions(
    reading: readonly ClauseReading[],
    id: string,
    operation: RegExp | null
): MentionIntention[] {
    return reading.flatMap((clause) =>
        clause.mentions.flatMap((mention, index) => {
            if (mention.id !== id) {
                return [];
            }
            const intention = intentionForMention({ clause, index, operation });
            return intention === null ? [] : [{ clause, mention, intention }];
        })
    );
}

/** Whether every clause naming this id with a directive removes it, and at least one does. */
function removesMentioned(intentions: readonly MentionIntention[]): boolean {
    return (
        intentions.some((entry) => entry.intention === 'remove') &&
        !intentions.some((entry) => entry.intention === 'preserve')
    );
}

/**
 * The hosts a removal names after the created object it removes, across binding words only ("the
 * compressor from Bass", "the compressor on Bass"), whether or not a pending creation is on them.
 */
function findNamedHosts(entry: MentionIntention): Set<string> {
    const { clause, mention } = entry;
    return new Set(
        clause.mentions.flatMap((host) => {
            if (host.id === null || host.start < mention.end) {
                return [];
            }
            return onlyBindingWords(clause.text.slice(mention.end, host.start).trim()) ? [host.id] : [];
        })
    );
}

function readPendingCreations(pendingActions: readonly Command[], context: ProjectContext): PendingCreation[] {
    return pendingActions.flatMap((pending): PendingCreation[] => {
        const { created, targetIds } = readStoredCommandObjects(pending, proposalCommandShape.createdObject, context);
        return created === null ? [] : [{ command: pending, names: created.names, hostIds: targetIds }];
    });
}

/**
 * A creation is dropped by the name of what it creates ("remove the compressor"), which names the whole
 * change; the id minted for it names nothing the user can say. That removal must pick out exactly this
 * one pending creation, by its name and the host named after it ("remove the compressor from Bass") or
 * by a name no other pending creation shares. A removal naming no host for a name several pending
 * creations share asks which one; one picking out none removes nothing.
 */
function readCreationRemoval(input: {
    prompt: string;
    command: Command;
    names: readonly string[];
    pendingActions: readonly Command[];
    context: ProjectContext;
}): RemovalReading {
    const creations = readPendingCreations(input.pendingActions, input.context);
    const extra = creations.flatMap((creation) => [
        ...creation.names.map((name) => ({ name, id: createdNameId(name) })),
        ...creation.hostIds.map((id) => ({ name: id, id })),
    ]);
    const reading = readRequest(input.prompt, input.context, extra);
    let ambiguous: { name: string; hostIds: ReadonlySet<string> } | null = null;
    for (const name of input.names) {
        const intentions = readMentionIntentions(reading, createdNameId(name), null);
        if (!removesMentioned(intentions)) {
            continue;
        }
        const sameName = creations.filter((creation) =>
            creation.names.some((candidate) => candidate.toLowerCase() === name.toLowerCase())
        );
        const hostIds = new Set(sameName.flatMap((creation) => creation.hostIds));
        for (const entry of intentions) {
            const hosts = findNamedHosts(entry);
            if (hosts.size === 0 && sameName.length > 1) {
                ambiguous = { name, hostIds };
                continue;
            }
            const onNamedHost = sameName.filter((creation) => creation.hostIds.some((id) => hosts.has(id)));
            const picked = hosts.size === 0 ? sameName : onNamedHost;
            if (picked.length === 1 && picked[0]!.command === input.command) {
                return { status: 'removes' };
            }
        }
    }
    if (ambiguous !== null) {
        const hosts = Array.from(
            ambiguous.hostIds,
            (id) => input.context.tracks.find((track) => track.id === id)?.name ?? id
        );
        return {
            status: 'ambiguous',
            reason: `The request removes "${ambiguous.name}", which more than one pending change creates. Which one should go? Name where it is, as in "remove the ${ambiguous.name} from ${hosts[0] ?? 'that track'}" (${hosts.join(' or ')}).`,
        };
    }
    return { status: 'keeps' };
}

/**
 * Whether a request expressly drops one command of the stored card it refines, read in the same
 * clauses, whole names and removal vocabulary the refinement reader reads a card with a grounding
 * basis by. A command acting on objects is dropped by its own target and operation, every object id
 * it states named by a removal verb opening its clause and no clause keeping it; a creation by the
 * name of what it creates.
 */
export const readStoredCardRemoval: ReadCommandRemoval = ({ prompt, command, pendingActions, context }) => {
    const { created, targetIds } = readStoredCommandObjects(command, proposalCommandShape.createdObject, context);
    if (created !== null) {
        return readCreationRemoval({ prompt, command, names: created.names, pendingActions, context });
    }
    const operation = operationPattern(command.type);
    if (targetIds.length === 0 || operation === null) {
        return { status: 'keeps' };
    }
    const reading = readRequest(
        prompt,
        context,
        targetIds.map((id) => ({ name: id, id }))
    );
    const removes = targetIds.every((id) => removesMentioned(readMentionIntentions(reading, id, operation)));
    return removes ? { status: 'removes' } : { status: 'keeps' };
};
