import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { escapeRegExp } from './escapeRegExp';
import { normalizePromptText } from './normalizePromptText';
import { type PromptClause, type PromptRoleTexts } from './promptScope';
import { resolveClauseActionIntent } from './resolveClauseActionIntent';

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;

export type PromptClauseSpan = PromptClause & {
    end: number;
    roleTexts?: PromptRoleTexts;
    start: number;
};

type AttachedSourcePhrase = {
    actionType: string;
    end: number;
};

const ATTACHMENT_PATTERN = /\bwith\s+(?:(?:the|a|an)\s+)?/giu;

/**
 * The level action whose multi-word phrase ending in `from` opens `text`, and where that phrase
 * ends. Such a phrase names its sources after it and leaves its destination to what it is attached to.
 */
function getAttachedSourcePhrase(text: string, catalog: GroundingCatalog): AttachedSourcePhrase | null {
    for (const entry of catalog) {
        if (!entry.decibelLevelForms) {
            continue;
        }
        for (const phrase of entry.intentPhrases) {
            const words = normalizePromptText(phrase).split(' ');
            if (words.length < 2 || words.at(-1) !== 'from') {
                continue;
            }
            const pattern = new RegExp(
                `^${words.map((word) => escapeRegExp(word)).join('[^\\p{L}\\p{N}□]+')}(?![\\p{L}\\p{N}])`,
                'iu'
            );
            const match = pattern.exec(text);
            if (match) {
                return { actionType: entry.actionType, end: match[0].length };
            }
        }
    }
    return null;
}

/**
 * Splits "set up a new bus named Vocal Delay with sends from A" at `with` when a level action's
 * phrase ending in `from` follows it and the words before it already name another action. The head
 * keeps its own scope, so its values stop before `with`; the attached clause reads its sources after
 * its phrase and its destination from the head.
 */
export function splitAttachedSourceClauses(
    clauses: readonly PromptClauseSpan[],
    catalog: GroundingCatalog
): PromptClauseSpan[] {
    return clauses.flatMap((clause) => {
        for (const attachment of clause.masked.matchAll(ATTACHMENT_PATTERN)) {
            const attachedStart = attachment.index + attachment[0].length;
            const phrase = getAttachedSourcePhrase(clause.masked.slice(attachedStart), catalog);
            if (!phrase) {
                continue;
            }
            const headLength = clause.text.slice(0, attachment.index).trimEnd().length;
            const headIntent = resolveClauseActionIntent(clause.masked.slice(0, headLength), catalog);
            if (!headIntent || headIntent.actionType === phrase.actionType) {
                continue;
            }
            const head: PromptClauseSpan = {
                end: clause.start + headLength,
                masked: clause.masked.slice(0, headLength),
                start: clause.start,
                text: clause.text.slice(0, headLength),
            };
            const attached: PromptClauseSpan = {
                end: clause.end,
                masked: clause.masked.slice(attachedStart),
                roleTexts: {
                    destination: head.text,
                    source: clause.text.slice(attachedStart + phrase.end).trim(),
                },
                start: clause.start + attachedStart,
                text: clause.text.slice(attachedStart),
            };
            return [head, attached];
        }
        return [clause];
    });
}
