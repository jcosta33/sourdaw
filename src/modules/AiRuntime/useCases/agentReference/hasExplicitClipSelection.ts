import { maskQuotedTextContents } from '../../transformers/promptParser/promptQuotedText';

import { normalizeAgentReferenceText } from './normalizeAgentReferenceText';

export function hasExplicitClipSelection(prompt: string): boolean {
    const normalized = normalizeAgentReferenceText(maskQuotedTextContents(prompt));
    return /\b(?:selected|current|this) (?:audio |midi )?clip\b/u.test(normalized);
}
