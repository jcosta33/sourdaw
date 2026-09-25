import { type PromptDecibelFigure } from './classifyPromptDecibelFigures';
import { normalizePromptText } from './normalizePromptText';

export type PromptReferenceSpan = {
    end: number;
    id: string;
    start: number;
};

/** What may stand between two members of one coordinated list: "A and B", "A, the B". */
const COORDINATING_GAP_PATTERN = /^(?:and )?(?:(?:the|a|an) )?$/u;

function isCoordinatingGap(gap: string): boolean {
    const normalizedGap = normalizePromptText(gap);
    return COORDINATING_GAP_PATTERN.test(normalizedGap.length === 0 ? '' : `${normalizedGap} `);
}

/**
 * The decibel figures one scope binds to each reference it names, keyed by reference id. A figure
 * binds to the nearest reference before it; a figure after a coordinated list ("from A and B at
 * -15 dB") binds to every member of that list. A figure no reference precedes binds to none.
 *
 * Reference spans and figure indexes share one coordinate space: the scope text and its masked
 * form are the same length.
 */
export function bindDecibelFiguresToReferences(
    scopeText: string,
    references: readonly PromptReferenceSpan[],
    figures: readonly PromptDecibelFigure[]
): ReadonlyMap<string, readonly PromptDecibelFigure[]> {
    const orderedReferences = references.toSorted((left, right) => left.start - right.start);
    const boundFigures = new Map<string, PromptDecibelFigure[]>();
    for (const figure of figures) {
        const nearest = orderedReferences.findLastIndex((reference) => reference.end <= figure.index);
        if (nearest < 0) {
            continue;
        }
        let listStart = nearest;
        while (listStart > 0) {
            const previous = orderedReferences[listStart - 1];
            const current = orderedReferences[listStart];
            if (!previous || !current || !isCoordinatingGap(scopeText.slice(previous.end, current.start))) {
                break;
            }
            listStart -= 1;
        }
        for (const reference of orderedReferences.slice(listStart, nearest + 1)) {
            const referenceFigures = boundFigures.get(reference.id);
            if (referenceFigures) {
                referenceFigures.push(figure);
                continue;
            }
            boundFigures.set(reference.id, [figure]);
        }
    }
    return boundFigures;
}
