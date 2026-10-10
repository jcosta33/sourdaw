import { type getAppActionExecutionPolicy } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';

import { type PromptClauseSpan } from './groundingStrategies/splitAttachedSourceClauses';
import { type AgentReferenceCapability } from './isAgentReferenceCapabilityCandidate';
import { normalizeAgentReferenceText } from './normalizeAgentReferenceText';
import { resolveAgentReference } from './resolveAgentReference';

type AppActionRisk = ReturnType<typeof getAppActionExecutionPolicy>['risk'];

/**
 * Clauses that name a coordinated list of project references and then say once what happens to all
 * of them: "turn the Drums", "the Bass down 3 dB". Clause splitting cuts such a list at every `and`
 * and comma, so the list is read back across those clauses.
 */
export type CoordinatedTrackList = {
    firstClauseIndex: number;
    lastClauseIndex: number;
    start: number;
    end: number;
    /** The list's clauses with the list written as its first member alone: "turn the □□□□□ down 3 dB". */
    collapsedMasked: string;
    /** Each member's track, in list order, or null when any member does not name exactly one track. */
    memberIds: string[] | null;
};

/** The first clause: any words, an optional "both" and article, and a reference ending the clause. */
const LIST_HEAD_PATTERN = /^(?<lead>(?:.*?\s)?)(?<both>both\s+)?(?:(?:the|a|an)\s+)?(?<reference>□+)\s*$/iu;

/** A clause holding nothing but one more reference, after an optional article. */
const LIST_MEMBER_PATTERN = /^\s*(?:(?:the|a|an)\s+)?(?<reference>□+)\s*$/iu;

/** The last clause: its reference, then the words that apply to the whole list. */
const LIST_TAIL_PATTERN = /^\s*(?:(?:the|a|an)\s+)?(?<reference>□+)(?<tail>\s+[^□]*)$/iu;

/** What may separate two clauses of one list: "A and B", "A, B", "A, B, and C". */
const LIST_SEPARATOR_PATTERN = /^(?:,|,?\s*and)$/iu;

type ListMember = { start: number; end: number };

function separatesListMembers(prompt: string, previous: PromptClauseSpan, next: PromptClauseSpan): boolean {
    return LIST_SEPARATOR_PATTERN.test(prompt.slice(previous.end, next.start).trim());
}

function getReferenceMember(clause: PromptClauseSpan, reference: string): ListMember {
    const index = clause.masked.indexOf(reference);
    return { start: clause.start + index, end: clause.start + index + reference.length };
}

/**
 * The one track a member's whole text names. The canonical resolver must bind it on exact name or
 * literal id evidence, and that name or id must be the member's whole text, so a member never
 * stands for a track whose name it merely contains.
 */
function resolveWholeMember(input: {
    capability: AgentReferenceCapability;
    context: ProjectContext;
    memberText: string;
    risk: AppActionRisk;
}): string | null {
    const memberText = normalizeAgentReferenceText(input.memberText);
    const resolvedTracks = input.context.tracks.filter((track) => {
        if (
            normalizeAgentReferenceText(track.name) !== memberText &&
            normalizeAgentReferenceText(track.id) !== memberText
        ) {
            return false;
        }
        const result = resolveAgentReference({
            prompt: input.memberText,
            assertedId: track.id,
            capability: input.capability,
            context: input.context,
            risk: input.risk,
        });
        return result.status === 'resolved' && (result.evidence === 'exact-name' || result.evidence === 'literal-id');
    });
    return resolvedTracks.length === 1 ? resolvedTracks[0]!.id : null;
}

function resolveMembers(input: {
    capability: AgentReferenceCapability;
    context: ProjectContext;
    members: readonly ListMember[];
    prompt: string;
    risk: AppActionRisk;
}): string[] | null {
    const memberIds: string[] = [];
    for (const member of input.members) {
        const id = resolveWholeMember({
            capability: input.capability,
            context: input.context,
            memberText: input.prompt.slice(member.start, member.end),
            risk: input.risk,
        });
        if (id === null || memberIds.includes(id)) {
            return null;
        }
        memberIds.push(id);
    }
    return memberIds;
}

type ListHead = {
    /** The words before the list, masked: "turn " in "turn the Drums and the Bass down 3 dB". */
    lead: string;
    /** The "both " opening the list, or empty. */
    both: string;
    member: ListMember;
};

type ListTail = {
    member: ListMember;
    /** What the last clause says after its member: " down 3 dB". */
    tail: string;
};

function readListHead(clause: PromptClauseSpan): ListHead | null {
    const match = LIST_HEAD_PATTERN.exec(clause.masked);
    const lead = match?.groups?.lead ?? '';
    const reference = match?.groups?.reference;
    if (reference === undefined || lead.includes('□')) {
        return null;
    }
    return { lead, both: match?.groups?.both ?? '', member: getReferenceMember(clause, reference) };
}

function readListTail(clause: PromptClauseSpan): ListTail | null {
    const match = LIST_TAIL_PATTERN.exec(clause.masked);
    const reference = match?.groups?.reference;
    const tail = match?.groups?.tail ?? '';
    if (reference === undefined || tail.trim().length === 0) {
        return null;
    }
    return { member: getReferenceMember(clause, reference), tail };
}

/** The list that opens at `headIndex`, or null when no complete list does. */
function readListAt(input: {
    capability: AgentReferenceCapability;
    clauses: readonly PromptClauseSpan[];
    context: ProjectContext;
    headIndex: number;
    prompt: string;
    risk: AppActionRisk;
}): CoordinatedTrackList | null {
    const head = input.clauses[input.headIndex]!;
    const listHead = readListHead(head);
    if (listHead === null) {
        return null;
    }
    const members = [listHead.member];
    for (let index = input.headIndex + 1; index < input.clauses.length; index += 1) {
        const clause = input.clauses[index]!;
        if (!separatesListMembers(input.prompt, input.clauses[index - 1]!, clause)) {
            return null;
        }
        const memberReference = LIST_MEMBER_PATTERN.exec(clause.masked)?.groups?.reference;
        if (memberReference !== undefined) {
            members.push(getReferenceMember(clause, memberReference));
            continue;
        }
        const listTail = readListTail(clause);
        if (listTail === null) {
            return null;
        }
        members.push(listTail.member);
        if (listHead.both.length > 0 && members.length !== 2) {
            return null;
        }
        const headWithoutBoth = head.masked.slice(listHead.lead.length + listHead.both.length).trimEnd();
        return {
            firstClauseIndex: input.headIndex,
            lastClauseIndex: index,
            start: head.start,
            end: clause.end,
            collapsedMasked: `${listHead.lead}${headWithoutBoth}${listTail.tail}`,
            memberIds: resolveMembers({ ...input, members }),
        };
    }
    return null;
}

/**
 * Every coordinated list of references the clauses hold, in order. A list needs at least two
 * members, each separated from the next only by `and` or a comma, and its last clause must say
 * something after its member that names no further reference.
 */
export function findCoordinatedTrackLists(input: {
    capability: AgentReferenceCapability;
    clauses: readonly PromptClauseSpan[];
    context: ProjectContext;
    prompt: string;
    risk: AppActionRisk;
}): CoordinatedTrackList[] {
    const lists: CoordinatedTrackList[] = [];
    let headIndex = 0;
    while (headIndex < input.clauses.length) {
        const list = readListAt({ ...input, headIndex });
        if (list) {
            lists.push(list);
            headIndex = list.lastClauseIndex + 1;
        } else {
            headIndex += 1;
        }
    }
    return lists;
}
