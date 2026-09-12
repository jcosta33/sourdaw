export function maskQuotedLabels(text: string): string {
    return text.replaceAll(/"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’/gu, (label) => {
        const innerLabel = label.slice(1, -1).trim();
        const containsOnlyMaskedProjectReferences = /^(?:□+|clip□*)(?:\s+(?:□+|clip□*))*$/u.test(innerLabel);
        if (innerLabel.length === 0 || containsOnlyMaskedProjectReferences) {
            return label;
        }
        const closingQuote = label.at(-1)!;
        return `${label[0]!}${' '.repeat(label.length - 2)}${closingQuote}`;
    });
}
