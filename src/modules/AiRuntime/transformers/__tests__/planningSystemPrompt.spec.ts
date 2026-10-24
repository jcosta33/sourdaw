import { describe, expect, it } from 'vitest';

import { buildPlanningSystemPrompt } from '../buildPlanningSystemPrompt';

type MethodStep = { name: string; clause: string };

/**
 * Each clause of the mixing method as the planning prompt states it, with its marker and closing
 * delimiter. The whole clause is pinned, so a negation inserted anywhere inside it ("never
 * measure the preview ...") no longer matches. The order is the tool loop's: a preview is measured
 * before the terminal propose that adopts it by call id.
 */
const METHOD_STEPS: readonly MethodStep[] = [
    {
        name: 'the method applies to a mix outcome without values',
        clause: 'When the request asks for a mix outcome without naming values, such as warmer or less muddy, ',
    },
    {
        name: 'resolve the target',
        clause: 'work in this order: (1) resolve the target from the project context; ',
    },
    { name: 'measure the target', clause: '(2) measure it with analysis.measure; ' },
    {
        name: 'discover and expand a recipe',
        clause: '(3) discover a recipe with recipe.discover and expand it with recipe.expand; ',
    },
    { name: 'plan values inside the recipe ranges', clause: "(4) plan values inside the recipe's ranges; " },
    {
        name: 'measure the planned list as a preview',
        clause: "(5) measure that planned list as a preview with analysis.measure subject 'preview' and the list as proposal; ",
    },
    {
        name: 'propose adopting only the preview call id',
        clause: "(6) propose with command.batch.propose, adopting only the preview's callId in compiledCallIds, because its list already carries the recipe's commands. ",
    },
    {
        name: 'reads needing no earlier receipt share a turn',
        clause: 'Reads that need no earlier receipt share one turn, such as analysis.measure on the target beside recipe.discover; recipe.expand, the preview and the propose each wait for the receipt before them. ',
    },
    { name: 'propose ends the run', clause: 'command.batch.propose ends the run, so measure before it. ' },
    {
        name: 'without a preview, adopt the compilation',
        clause: "With no preview, adopt recipe.expand's or transform.compile's callId instead. ",
    },
    {
        name: 'when the context cannot resolve the target, query alone and skip both measurements',
        clause: "If the project context cannot resolve the target, call project.query alone first; the preview would then need a turn the run does not have, so skip (2) and (5) and propose adopting recipe.expand's callId.",
    },
];

describe('buildPlanningSystemPrompt mixing method', () => {
    const prompt = buildPlanningSystemPrompt();

    it.each(METHOD_STEPS)('states the clause: $name', ({ clause }) => {
        expect(prompt).toContain(clause);
    });

    it('states the clauses in the order the tool loop runs them', () => {
        const positions = METHOD_STEPS.map(({ clause }) => prompt.indexOf(clause));

        expect(positions.every((position) => position >= 0)).toBe(true);
        expect(positions).toEqual([...positions].sort((left, right) => left - right));
    });

    it('states the whole method as one uninterrupted passage', () => {
        const method = METHOD_STEPS.map(({ clause }) => clause).join('');

        expect(prompt).toContain(method);
    });

    it('puts the creative interpretation in the first turn, alone, before any other tool', () => {
        expect(prompt).toContain(
            'call selectCreativeInterpretation alone in the first turn, before any other tool, choosing only'
        );
    });

    it('does not tell the planner to report deltas, which an answer beside a propose would refuse', () => {
        expect(prompt).not.toContain('report the measured deltas');
    });

    it('states that recipes and their ranges come only from the catalog', () => {
        expect(prompt).toContain('Recipes and their ranges come only from the catalog, never invented.');
    });

    it('states that explicit literal edits skip measurement', () => {
        expect(prompt).toContain('Explicit literal edits skip measurement.');
    });

    it('states the decibel forms', () => {
        expect(prompt).toContain(
            'A level takes exactly one of its linear field (gain, level, value), its absolute decibel field (gainDb, levelDb, valueDb) or relative deltaDb.'
        );
    });

    it('states the set selector fields', () => {
        expect(prompt).toContain(
            "selector with targetArgument, entity, where or match, excludeIds and a quantity of exactly or maximum with unit 'targets'."
        );
    });
});
