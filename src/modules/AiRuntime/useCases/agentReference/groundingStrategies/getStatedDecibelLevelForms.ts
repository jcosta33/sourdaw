import { classifyPromptDecibelFigures } from './classifyPromptDecibelFigures';
import { findPromptNumbers } from './findPromptNumbers';

type DecibelLevelForm = 'absolute-decibel' | 'relative-decibel';

/**
 * The decibel level forms one clause states a figure in: "to -6 dB" states where a level lands,
 * "by 3 dB" or "down 3 dB" how far it moves. A figure whose form the clause leaves unsaid states
 * neither.
 */
export function getStatedDecibelLevelForms(maskedText: string): ReadonlySet<DecibelLevelForm> {
    const forms = new Set<DecibelLevelForm>();
    for (const figure of classifyPromptDecibelFigures(maskedText, findPromptNumbers(maskedText))) {
        if (figure.form === 'absolute') {
            forms.add('absolute-decibel');
        } else if (figure.form === 'relative') {
            forms.add('relative-decibel');
        }
    }
    return forms;
}
