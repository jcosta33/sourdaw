import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';

import { type ProposalGroundingCommand } from '../../models/ProposalGroundingBasis';

import { normalizePromptText } from './groundingStrategies/normalizePromptText';

/**
 * Words that may open a clause ahead of its verb. The clause splitter consumes a conjunction between
 * two clauses, so `and`, `but` and `then` open only the refinement's first clause ("and lower it 2 dB").
 */
const CLAUSE_OPENING_WORDS: ReadonlySet<string> = new Set(['and', 'but', 'then', 'please']);
const ARTICLE_WORDS: ReadonlySet<string> = new Set(['the', 'a', 'an']);
/** The verbs a value clause sets its value by. */
const VALUE_VERBS: readonly string[] = ['make', 'set', 'put', 'turn', 'bring', 'move', 'change'];
/**
 * The verbs that move what they act on. Beside a figure and a side ("bring it 10 right", "move it 10 to
 * the right", "bring it right 10") they may say how far a pan moves toward that side rather than where
 * it lands, so such a clause is asked, with or without `to`, whatever action the verb would otherwise
 * read as. `make`, `set`, `put` and `change` name the value it becomes, so their side is where the pan
 * lands. Only a pan reads a side at all.
 */
const MOVING_VERBS: readonly string[] = ['bring', 'turn', 'move', 'shift', 'nudge', 'push'];

/** The index of a clause's first word that is no opening word: its verb, or the end when it has none. */
function findVerbIndex(tokens: readonly string[]): number {
    const index = tokens.findIndex((word) => !CLAUSE_OPENING_WORDS.has(word));
    return index < 0 ? tokens.length : index;
}

/** The words of a clause with every object name masked, its opening words and articles left out. */
function readActionWords(masked: string): string[] {
    const tokens = normalizePromptText(masked)
        .split(' ')
        .filter((word) => word.length > 0);
    return tokens.slice(findVerbIndex(tokens)).filter((word) => !ARTICLE_WORDS.has(word));
}

function isSameWords(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((word, index) => word === right[index]);
}

/**
 * The boolean a clause's action words state for a pending toggle, read from the action registry's own
 * true and false phrases for its type ("mute" and "unmute", "solo" and "unsolo", "arm" and "disarm"):
 * the clause's words, articles and opening words aside, must be exactly one such phrase. `null` when
 * they are none of them ("mute only", "mute off").
 */
function readToggle(
    clause: { masked: string },
    command: ProposalGroundingCommand
): { argument: string; value: boolean } | null {
    const words = readActionWords(clause.masked);
    const states = (phrases: readonly string[]) =>
        phrases.some((phrase) => isSameWords(words, normalizePromptText(phrase).split(' ')));
    for (const rule of getExecutableAppActionGroundingRules(command.type)?.valueRules ?? []) {
        if (rule.kind !== 'boolean-intent') {
            continue;
        }
        if (states(rule.truePhrases)) {
            return { argument: rule.argument, value: true };
        }
        if (states(rule.falsePhrases)) {
            return { argument: rule.argument, value: false };
        }
    }
    return null;
}

type ToggledChange =
    | { status: 'none' }
    | { status: 'several' }
    | { status: 'one'; index: number; value: { argument: string; toggled: boolean } };

/**
 * The pending toggle a figureless clause's toggle word changes ("unmute Bass" against a pending mute):
 * the one pending command it names whose value the word turns the other way, or `several` when it
 * names more than one command. `none` when its words state no toggle, or only the value each command
 * already takes, which restates it.
 */
function readToggledChange(
    clause: { masked: string },
    scoped: ReadonlyArray<{ index: number; command: ProposalGroundingCommand }>
): ToggledChange {
    const changed = scoped.flatMap((view) => {
        const toggle = readToggle(clause, view.command);
        return toggle === null || view.command.payload[toggle.argument] === toggle.value ? [] : [{ view, toggle }];
    });
    const [only] = changed;
    if (only === undefined) {
        return { status: 'none' };
    }
    if (scoped.length > 1) {
        return { status: 'several' };
    }
    return {
        status: 'one',
        index: only.view.index,
        value: { argument: only.toggle.argument, toggled: only.toggle.value },
    };
}

/** How a refinement clause states its action: the words it states it in, and the toggle value they name. */
export const refinementActionWords = {
    valueVerbs: VALUE_VERBS,
    movingVerbs: MOVING_VERBS,
    verbIndex: findVerbIndex,
    actionWords: readActionWords,
    isSame: isSameWords,
    toggle: readToggle,
    toggledChange: readToggledChange,
} as const;
