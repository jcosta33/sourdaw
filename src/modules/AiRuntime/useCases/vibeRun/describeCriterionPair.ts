import { type MetricGoalEvaluation } from '../../models/MetricGoalAdmission';
import { readVerdictFigures } from '../readVerdictFigures';

import { formatVibeFigure } from './formatVibeFigure';
import { withVibeUnit } from './withVibeUnit';

type Criterion = MetricGoalEvaluation['criteria'][number];

/**
 * Two figures a card prints beside one criterion's verdict, as two trimmed decimals unless those would
 * read as another verdict, and for a broken tolerance the movement that the printed endpoints show.
 */
export function describeCriterionPair(
    criterion: Criterion,
    from: number | undefined,
    to: number | undefined
): { figures: string; movement: string | null } {
    if (from === undefined || to === undefined) {
        return {
            figures: `${formatVibeFigure(from, criterion.unit)} → ${formatVibeFigure(to, criterion.unit)}`,
            movement: null,
        };
    }
    const printed = readVerdictFigures({
        from,
        to,
        relation: criterion.relation,
        tolerance: criterion.tolerance,
        rounding: 'decimals',
        start: 2,
    });
    function show(value: number): string {
        return withVibeUnit(String(value), criterion.unit);
    }
    return {
        figures: `${show(printed.from)} → ${show(printed.to)}`,
        movement: printed.broken ? show(printed.movement) : null,
    };
}
