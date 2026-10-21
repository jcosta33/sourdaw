import {
    findAgentReferenceNameSpans,
    type AgentReferenceNameCloseness,
    type AgentReferenceNameForms,
    type AgentReferenceNameSpan,
    type AgentReferenceTextRange,
} from './findAgentReferenceNameSpans';

/** A range of the text that states one object's name. */
export type AgentReferenceNamedRange = AgentReferenceTextRange & { id: string };

const CLOSENESS_RANK: Readonly<Record<AgentReferenceNameCloseness, number>> = {
    typed: 0,
    folded: 1,
    'number-form': 2,
};

/** Whether the other span reads the span's range better: it covers a longer range, or the same range more closely. */
function readsRangeBetter(other: AgentReferenceNameSpan, span: AgentReferenceNameSpan): boolean {
    if (other.start > span.start || span.end > other.end) {
        return false;
    }
    const longer = other.end - other.start > span.end - span.start;
    return longer || CLOSENESS_RANK[other.closeness] < CLOSENESS_RANK[span.closeness];
}

/**
 * The ranges of the text that state each object's name where no other object's name reads that range
 * better: a longer name covering it ("Drum" in "Drum Bus" states the bus) or the same range read more
 * closely ("Vocal" states Vocal, not Vocals; "Café" states Café, not Cafe). Objects whose names read a
 * range equally all state it. Each name is read against the others as its siblings.
 */
export function getBestAgentReferenceNameRanges(
    text: string,
    objects: readonly { id: string; name: string }[],
    forms: AgentReferenceNameForms
): AgentReferenceNamedRange[] {
    const names = objects.map((object) => object.name);
    const spans = objects.flatMap((object) =>
        findAgentReferenceNameSpans(text, object.name, forms, names).map((span) => ({ ...span, id: object.id }))
    );
    return spans
        .filter((span) => !spans.some((other) => other.id !== span.id && readsRangeBetter(other, span)))
        .map(({ id, start, end }) => ({ id, start, end }));
}
