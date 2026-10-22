import { maskQuotedTextContents } from '../../transformers/promptParser/promptQuotedText';

import { normalizeAgentReferenceText } from './normalizeAgentReferenceText';

export function hasExplicitTrackSelection(prompt: string): boolean {
    const normalized = normalizeAgentReferenceText(maskQuotedTextContents(prompt));
    return /\b(?:selected|current|this) (?:audio |midi |bus |folder )?track\b/u.test(normalized);
}
