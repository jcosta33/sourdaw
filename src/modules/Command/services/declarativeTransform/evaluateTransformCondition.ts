import { type TransformComparison, type TransformCondition } from '../../models/DeclarativeTransform';

import { evaluateTransformExpression, type TransformEvaluationContext } from './evaluateTransformExpression';

export type TransformConditionResult = { status: 'evaluated'; value: boolean } | { status: 'rejected'; reason: string };

const COMPARISONS: Readonly<Record<TransformComparison, (left: number, right: number) => boolean>> = {
    lt: (left, right) => left < right,
    le: (left, right) => left <= right,
    eq: (left, right) => left === right,
    ge: (left, right) => left >= right,
    gt: (left, right) => left > right,
};

function evaluateComparison(
    condition: Extract<TransformCondition, { cmp: TransformComparison }>,
    context: TransformEvaluationContext
): TransformConditionResult {
    const left = evaluateTransformExpression(condition.left, context);
    if (left.status === 'rejected') {
        return left;
    }
    const right = evaluateTransformExpression(condition.right, context);
    if (right.status === 'rejected') {
        return right;
    }
    if (left.quantity.unit !== right.quantity.unit) {
        return {
            status: 'rejected',
            reason: `unit mismatch: ${left.quantity.unit} ${condition.cmp} ${right.quantity.unit} in ${context.label}`,
        };
    }
    return { status: 'evaluated', value: COMPARISONS[condition.cmp](left.quantity.value, right.quantity.value) };
}

function evaluateGroup(
    conditions: readonly TransformCondition[],
    context: TransformEvaluationContext,
    requireEvery: boolean
): TransformConditionResult {
    for (const member of conditions) {
        const result = evaluateTransformCondition(member, context);
        if (result.status === 'rejected') {
            return result;
        }
        if (result.value !== requireEvery) {
            return { status: 'evaluated', value: !requireEvery };
        }
    }
    return { status: 'evaluated', value: requireEvery };
}

/** Evaluates one condition tree; comparing two different units is a rejection, never a false. */
export function evaluateTransformCondition(
    condition: TransformCondition,
    context: TransformEvaluationContext
): TransformConditionResult {
    if ('cmp' in condition) {
        return evaluateComparison(condition, context);
    }
    if ('all' in condition) {
        return evaluateGroup(condition.all, context, true);
    }
    return evaluateGroup(condition.any, context, false);
}
