import { refinementRequestReading, type ReferenceCandidate } from './refinementRequestReading';

type FormPattern = {
    pattern: RegExp;
    /** Whether the slot may only name the rest of the mix ("keep everything else"). */
    restOnly: boolean;
    /** A `leave`/`leaving` … `alone` form, which beside a removal may narrow it. */
    leaveAlone: boolean;
    /** The imperative `leave` … `alone`, which removes the one pending object it names. */
    removalForm: boolean;
};

type StatedForm = { kind: 'rest' } | { kind: 'objects'; stated: string; leaveAlone: boolean; removalForm: boolean };

/** The project objects a refinement can name, and every object id the pending commands act on. */
type ProtectionScope = {
    candidates: readonly ReferenceCandidate[];
    pendingIds: ReadonlySet<string>;
};

/**
 * What a protection reads as, decided by what it names: the rest of the mix, protecting nothing; the
 * objects off the card it protects; one that cannot be protected apart from the pending changes, which
 * is asked; or the imperative `leave <object> alone` of an object it cannot protect, which the removal
 * reading reads.
 */
type ProtectionRead =
    | { kind: 'rest' }
    | { kind: 'protects'; ids: readonly string[]; leaveAlone: boolean }
    | { kind: 'asked'; leaveAlone: boolean }
    | { kind: 'removal'; leaveAlone: boolean };

const form = (pattern: RegExp, options: Partial<Omit<FormPattern, 'pattern'>> = {}): FormPattern => ({
    pattern,
    restOnly: options.restOnly ?? false,
    leaveAlone: options.leaveAlone ?? false,
    removalForm: options.removalForm ?? false,
});

/**
 * The closed protection forms, in normalized words, each stating its slot once and tried in order, so a
 * form opening with its verb is read before the forms opening with their object.
 */
const PROTECTION_FORMS: readonly FormPattern[] = [
    form(
        /^(?:leave|leaving|keep|keeping|preserve|preserving)\s+(.+?)\s+(?:unchanged|untouched|the\s+same|as\s+(?:it\s+)?is|as\s+proposed|the\s+way\s+it\s+is)$/u
    ),
    form(/^leaving\s+(.+?)\s+alone$/u, { leaveAlone: true }),
    form(/^leave\s+(.+?)\s+alone$/u, { leaveAlone: true, removalForm: true }),
    form(/^with\s+(.+?)\s+unchanged$/u),
    form(/^(.+?)\s+should\s+stay\s+the\s+same$/u),
    form(
        /^(.+?)\s+(?:(?:stays|stay|remains|remain)\s+)?(?:untouched|unchanged|the\s+same|as\s+(?:it\s+)?is|the\s+way\s+it\s+is)$/u
    ),
    form(/^no\s+changes?\s+to\s+(.+)$/u),
    form(/^(?:keep|keeping)\s+(.+)$/u, { restOnly: true }),
];
/** The slot a protection states when it keeps the rest of the mix as it is, naming nothing. */
const REST_OF_MIX = /^(?:everything\s+else|anything\s+else|all\s+else|the\s+rest)$/u;
/** The whole clauses that keep the rest of the mix as it is without a slot. */
const REST_CLAUSE = /^(?:nothing\s+else(?:\s+should\s+change)?|no\s+other\s+changes?)$/u;

/** The closed form a whole clause, in normalized words, takes, and the slot it states; `null` for none. */
function readStatedForm(words: string): StatedForm | null {
    if (REST_CLAUSE.test(words)) {
        return { kind: 'rest' };
    }
    for (const candidate of PROTECTION_FORMS) {
        const stated = candidate.pattern.exec(words)?.[1];
        if (stated === undefined) {
            continue;
        }
        if (REST_OF_MIX.test(stated)) {
            return { kind: 'rest' };
        }
        if (candidate.restOnly) {
            return null;
        }
        return { kind: 'objects', stated, leaveAlone: candidate.leaveAlone, removalForm: candidate.removalForm };
    }
    return null;
}

/**
 * The project objects a slot names, each in whole: the slot as one name, or each part of its list
 * between `and`s; `null` when any part names no project object.
 */
function resolveSlotObjects(stated: string, candidates: readonly ReferenceCandidate[]) {
    const parts = stated.split(/\s+and\s+/u);
    for (const list of parts.length > 1 ? [[stated], parts] : [[stated]]) {
        const named = list.flatMap((item) => {
            const resolved = refinementRequestReading.resolveReference(item, candidates);
            return resolved === null ? [] : [resolved];
        });
        if (named.length === list.length) {
            return named;
        }
    }
    return null;
}

type NamedObject = NonNullable<ReturnType<typeof resolveSlotObjects>>[number];

/**
 * The one object id a protection keeps for a named object: a whole object, stated with no operation
 * word, that its name alone denotes and no pending command acts on; `null` otherwise.
 */
function readProtectableId(named: NamedObject, pendingIds: ReadonlySet<string>): string | null {
    const ids = Array.from(named.candidate.denotes);
    const [id] = ids;
    if (named.reference.operations !== null || id === undefined || ids.length !== 1 || pendingIds.has(id)) {
        return null;
    }
    return id;
}

type NamedProtection = Extract<ProtectionRead, { kind: 'protects' | 'asked' }>;

/** What a closed form naming objects protects, given the objects its slot names: all of them, or it asks. */
function readNamedProtection(
    stated: Extract<StatedForm, { kind: 'objects' }>,
    named: readonly NamedObject[] | null,
    pendingIds: ReadonlySet<string>
): NamedProtection {
    const ids = (named ?? []).flatMap((object) => {
        const id = readProtectableId(object, pendingIds);
        return id === null ? [] : [id];
    });
    const { leaveAlone } = stated;
    if (named === null || ids.length !== named.length) {
        return { kind: 'asked', leaveAlone };
    }
    return { kind: 'protects', ids, leaveAlone };
}

/**
 * How one whole clause, in normalized words, reads as a protection; `null` when it takes no closed
 * form. The imperative `leave <object> alone` naming one object it cannot protect, or none, is the
 * removal the removal reading reads.
 */
function readProtection(words: string, scope: ProtectionScope): ProtectionRead | null {
    const stated = readStatedForm(words);
    if (stated === null || stated.kind === 'rest') {
        return stated;
    }
    const named = resolveSlotObjects(stated.stated, scope.candidates);
    const read = readNamedProtection(stated, named, scope.pendingIds);
    if (read.kind === 'asked' && stated.removalForm && (named === null || named.length === 1)) {
        return { kind: 'removal', leaveAlone: true };
    }
    return read;
}

/**
 * A protection naming several objects that the clause splitter cut at its `and`s and commas ("leaving
 * the Drum Bus and Bass unchanged"), read from the clauses the reader joined across nothing but those
 * separators, in normalized words: the fewest leading clauses that join, with `and`, into exactly one
 * closed form whose slot is a list of more than one whole object name, and how many clauses it spans.
 */
function readProtectionList(
    fragments: readonly string[],
    scope: ProtectionScope
): { count: number; read: NamedProtection } | null {
    for (let count = 2; count <= fragments.length; count += 1) {
        const stated = readStatedForm(fragments.slice(0, count).join(' and '));
        if (stated?.kind !== 'objects') {
            continue;
        }
        const named = resolveSlotObjects(stated.stated, scope.candidates);
        if (named !== null && named.length > 1) {
            return { count, read: readNamedProtection(stated, named, scope.pendingIds) };
        }
    }
    return null;
}

/**
 * How a refinement clause reads as a protection: one closed reader of every closed form, its outcome
 * decided by what the form names. The rest of the mix protects nothing; one or more whole project
 * objects off the card, each named alone and stated with no operation word, are each protected; a
 * pending object, an operation, a name several objects share, "it", "everything" or anything else is
 * asked.
 */
export const refinementProtectionForms = {
    read: readProtection,
    readList: readProtectionList,
} as const;
