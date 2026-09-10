import { normalizePromptText } from './normalizePromptText';

export function getIntentPhraseIndex(text: string, intentPhrase: string): number {
    const normalizedText = ` ${normalizePromptText(text)} `;
    return normalizedText.indexOf(` ${normalizePromptText(intentPhrase)} `);
}
