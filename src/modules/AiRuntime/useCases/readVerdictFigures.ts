import { type MetricGoalEvaluation } from '../models/MetricGoalAdmission';

import { movedWithin } from './movedWithin';

type Relation = MetricGoalEvaluation['criteria'][number]['relation'];

/** How a figure is cut: to a count of significant digits or to a count of decimal places. */
export type FigureRounding = 'significant' | 'decimals';

/** The printed endpoints and movement, and whether the real pair breaks a tolerance, which a sentence then states as the movement. */
export type VerdictFigures = { from: number; to: number; movement: number; broken: boolean };

const MOST_DIGITS = 17;

function rounded(value: number, digits: number, rounding: FigureRounding): number {
    return Number(rounding === 'significant' ? value.toPrecision(digits) : value.toFixed(digits));
}

/** Whether a pair of figures meets a relation that compares only the pair; null for a relation that needs more. */
function meetsRelation(relation: Relation, tolerance: number, from: number, to: number): boolean | null {
    if (relation === 'increase') {
        return to > from;
    }
    if (relation === 'decrease') {
        return to < from;
    }
    if (relation === 'hold') {
        return movedWithin(from, to, tolerance) && movedWithin(to, from, tolerance);
    }
    if (relation === 'no-increase') {
        return movedWithin(from, to, tolerance);
    }
    if (relation === 'no-decrease') {
        return movedWithin(to, from, tolerance);
    }
    return null;
}

/** A relation whose broken verdict is a movement past its tolerance, which a sentence states as a figure. */
function isToleranceRelation(relation: Relation): boolean {
    return relation === 'hold' || relation === 'no-increase' || relation === 'no-decrease';
}

/**
 * The fewest digits, `start` at least, at which the figures printed beside a verdict read as that verdict:
 * the printed endpoints meet or break the relation as the real ones do, and for a broken tolerance the
 * printed movement is above the tolerance and is the difference of the printed endpoints.
 */
export function readVerdictFigures(input: {
    from: number;
    to: number;
    relation: Relation;
    tolerance: number;
    rounding: FigureRounding;
    start: number;
    /** Whether the movement is the rounded real one or the difference of the printed endpoints, which a reader can check by subtracting. */
    movement?: 'real' | 'printed';
}): VerdictFigures {
    const { from, to, relation, tolerance, rounding, start } = input;
    const printedMovement = input.movement === 'printed';
    const real = meetsRelation(relation, tolerance, from, to);
    const stated = real === false && isToleranceRelation(relation);
    function exact(digits: number): VerdictFigures {
        const printedFrom = rounded(from, digits, rounding);
        const printedTo = rounded(to, digits, rounding);
        return {
            from: printedFrom,
            to: printedTo,
            movement: rounded(Math.abs(printedMovement ? printedTo - printedFrom : to - from), digits, rounding),
            broken: stated,
        };
    }
    if (real === null || !Number.isFinite(from) || !Number.isFinite(to)) {
        return exact(start);
    }
    for (let digits = start; digits < MOST_DIGITS; digits += 1) {
        const figures = exact(digits);
        if (meetsRelation(relation, tolerance, figures.from, figures.to) !== real) {
            continue;
        }
        const printedMovement = rounded(Math.abs(figures.to - figures.from), digits, rounding);
        if (stated && !(figures.movement > tolerance && printedMovement === figures.movement)) {
            continue;
        }
        return figures;
    }
    return exact(MOST_DIGITS);
}
