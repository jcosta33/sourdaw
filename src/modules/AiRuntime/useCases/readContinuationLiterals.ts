import { digest } from '#/utils/canonicalDigest';
import { type AppAction } from '#/utils/handlerContract';

import { type LastCommitContinuationLiteral } from '../models/MetricGoalAdmission';

import { type ContinuedFigure } from './lastCommitContinuation/lastCommitOutcome';

const METRIC_LITERAL_UNITS = ['LUFS', 'dBTP', 'dBFS', 'Hz'] as const;

function isMetricLiteralUnit(unit: string): unit is LastCommitContinuationLiteral['unit'] {
    return METRIC_LITERAL_UNITS.some((candidate) => candidate === unit);
}

/**
 * The continuation's figures stated in a unit metric admission reads, each bound to the one
 * materialized action that sets its landed value; a figure no action sets exactly is left unbound,
 * so metric admission refuses it as any unaccounted figure.
 */
export function readContinuationLiterals(
    prompt: string,
    figures: readonly ContinuedFigure[],
    actions: readonly AppAction[]
): LastCommitContinuationLiteral[] {
    return figures.flatMap((figure) => {
        if (!isMetricLiteralUnit(figure.unit)) {
            return [];
        }
        const actionIndex = actions.findIndex(
            (action) =>
                action.type === 'setDeviceParameter' &&
                action.payload.deviceId === figure.deviceId &&
                action.payload.paramId === figure.paramId &&
                action.payload.value === figure.landed
        );
        if (actionIndex < 0) {
            return [];
        }
        return [
            {
                kind: 'last-commit-continuation' as const,
                requestDigest: digest(prompt.trim()),
                actionIndex,
                unit: figure.unit,
                figure: figure.figure,
                comparative: figure.comparative,
                committed: figure.committed,
                landed: figure.landed,
            },
        ];
    });
}
