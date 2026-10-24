import { describe, expect, it } from 'vitest';

import { buildPlanningSystemPrompt } from '../buildPlanningSystemPrompt';

type MethodStep = { name: string; phrase: string };

/** Each step of the mixing method, in order, as the planning prompt must state it. */
const METHOD_STEPS: readonly MethodStep[] = [
    { name: 'resolve the target', phrase: 'resolve the target with project.query' },
    { name: 'measure', phrase: 'measure it with analysis.measure' },
    {
        name: 'discover and expand a recipe',
        phrase: 'discover a recipe with recipe.discover and expand it with recipe.expand',
    },
    {
        name: 'propose within recipe ranges',
        phrase: "propose values inside the recipe's ranges with command.batch.propose",
    },
    { name: 'measure the preview', phrase: "measure the preview with analysis.measure subject 'preview'" },
    { name: 'report the deltas', phrase: 'report the measured deltas' },
];

describe('buildPlanningSystemPrompt mixing method', () => {
    const prompt = buildPlanningSystemPrompt();

    it.each(METHOD_STEPS)('states the step: $name', ({ phrase }) => {
        expect(prompt).toContain(phrase);
    });

    it('states the steps in method order', () => {
        const positions = METHOD_STEPS.map(({ phrase }) => prompt.indexOf(phrase));

        expect(positions.every((position) => position >= 0)).toBe(true);
        expect(positions).toEqual([...positions].sort((left, right) => left - right));
    });

    it('names transform.compile and compiledCallIds as the way to adopt a compiled call', () => {
        expect(prompt).toContain('transform.compile');
        expect(prompt).toContain('compiledCallIds');
    });

    it('states that recipes and their ranges come only from the catalog', () => {
        expect(prompt).toContain('Recipes and their ranges come only from the catalog, never invented.');
    });

    it('states that explicit literal edits skip measurement', () => {
        expect(prompt).toContain('Explicit literal edits skip measurement.');
    });

    it('states the decibel forms', () => {
        expect(prompt).toContain('gainDb');
        expect(prompt).toContain('levelDb');
        expect(prompt).toContain('valueDb');
        expect(prompt).toContain('deltaDb');
    });

    it('states the set selector fields', () => {
        expect(prompt).toContain('selector with targetArgument, entity, where or match, excludeIds');
        expect(prompt).toContain('quantity of exactly or maximum');
    });
});
