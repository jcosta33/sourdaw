import { escapeRegExp } from './escapeRegExp';

/** One decibel figure after its `by` connector: "by 1.5 dB". */
const FIGURE = String.raw`by\s+\+?(?:\d+(?:\.\d+)?|\.\d+)\s*d\s?b`;

/** Nothing after the request's stated change but punctuation and whitespace. */
const END = String.raw`[\p{P}\s]*$`;

/** The last masked project reference in the text: the final target the request names. */
const LAST_REFERENCE_PATTERN = /□+(?!.*□)/su;

function sectionNamePattern(name: string): string {
    return name
        .trim()
        .split(/\s+/u)
        .map(escapeRegExp)
        .join(String.raw`\s+`);
}

/**
 * The one existing section a source-set lift applies in, read from the masked request text that runs
 * from the lift's own clause to the end of the request; null when that text states anything else.
 *
 * After its last target the text must be exactly the figure and the section, in either order ("by
 * 1.5 dB in Chorus Two", "in Chorus Two by 1.5 dB"), and the section phrase must be one section's
 * full name. A section whose name is only part of the phrase ("Chorus" in "Chorus Two") is no match,
 * and any other word after the targets ("except the last bar", "but not in the first half") may
 * narrow the change to part of the section or of the set, which one call over every member and the
 * whole section cannot honour.
 */
export function readSourceSetLiftShape(
    maskedRequestFromScope: string,
    sections: readonly { name: string }[]
): { sectionName: string } | null {
    const lastReference = LAST_REFERENCE_PATTERN.exec(maskedRequestFromScope);
    if (lastReference === null) {
        return null;
    }
    const afterTargets = maskedRequestFromScope.slice(lastReference.index + lastReference[0].length);
    const matches = sections.filter((section) => {
        const sectionPhrase = String.raw`(?:in|during)\s+(?:the\s+)?${sectionNamePattern(section.name)}`;
        return [
            new RegExp(String.raw`^\s+${FIGURE}\s+${sectionPhrase}${END}`, 'iu'),
            new RegExp(String.raw`^\s+${sectionPhrase}\s+${FIGURE}${END}`, 'iu'),
        ].some((pattern) => pattern.test(afterTargets));
    });
    return matches.length === 1 ? { sectionName: matches[0]!.name } : null;
}
