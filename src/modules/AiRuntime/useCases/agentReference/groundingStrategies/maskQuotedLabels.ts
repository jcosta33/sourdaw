import { startsWordInitialElision } from '../../../transformers/promptParser/wordInitialElision';

const QUOTED_LABEL = /"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’/gu;

function maskLabel(label: string): string {
    const innerLabel = label.slice(1, -1).trim();
    const containsOnlyMaskedProjectReferences = /^(?:□+|clip□*)(?:\s+(?:□+|clip□*))*$/u.test(innerLabel);
    if (innerLabel.length === 0 || containsOnlyMaskedProjectReferences) {
        return label;
    }
    const closingQuote = label.at(-1)!;
    return `${label[0]!}${' '.repeat(label.length - 2)}${closingQuote}`;
}

export function maskQuotedLabels(text: string): string {
    const pattern = new RegExp(QUOTED_LABEL);
    let masked = '';
    let copiedUpTo = 0;
    let match = pattern.exec(text);
    while (match !== null) {
        if (match[0][0] === "'" && startsWordInitialElision(text, match.index)) {
            pattern.lastIndex = match.index + 1;
        } else {
            masked += text.slice(copiedUpTo, match.index) + maskLabel(match[0]);
            copiedUpTo = match.index + match[0].length;
        }
        match = pattern.exec(text);
    }
    return masked + text.slice(copiedUpTo);
}
