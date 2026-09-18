import { getIntentPhraseIndex } from './getIntentPhraseIndex';
import { normalizePromptText } from './normalizePromptText';

export function isNegatedIntent(text: string, intentPhrase: string): boolean {
    const phraseIndex = getIntentPhraseIndex(text, intentPhrase);
    if (phraseIndex < 0) {
        return false;
    }
    const normalizedText = ` ${normalizePromptText(text)} `;
    const prefix = normalizedText.slice(0, phraseIndex);
    return /\b(?:do not|don t|dont|never|not)\b/u.test(prefix);
}
