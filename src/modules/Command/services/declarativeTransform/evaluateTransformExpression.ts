import {
    DECLARATIVE_TRANSFORM_MAX_EXPRESSION_DEPTH,
    DECLARATIVE_TRANSFORM_SCALING_UNITS,
    type TransformExpression,
    type TransformItemBinding,
    type TransformQuantity,
} from '../../models/DeclarativeTransform';

export type TransformEvaluationContext = {
    items: ReadonlyMap<string, TransformItemBinding>;
    /** Names the variable or step the expression belongs to, so a rejection points at its source. */
    label: string;
    random: () => number;
    tempo: number;
    variables: ReadonlyMap<string, TransformQuantity>;
};

export type TransformExpressionResult =
    { status: 'evaluated'; quantity: TransformQuantity } | { status: 'rejected'; reason: string };

const OPERATOR_SYMBOLS = { add: '+', sub: '-', mul: '*', div: '/' } as const;

const SECONDS_PER_MINUTE = 60;

function rejected(reason: string): TransformExpressionResult {
    return { status: 'rejected', reason };
}

function evaluated(unit: TransformQuantity['unit'], value: number, label: string): TransformExpressionResult {
    if (!Number.isFinite(value)) {
        return rejected(`non-finite value in ${label}`);
    }
    return { status: 'evaluated', quantity: { unit, value } };
}

function evaluateAdditive(
    node: 'add' | 'sub',
    left: TransformQuantity,
    right: TransformQuantity,
    label: string
): TransformExpressionResult {
    if (left.unit !== right.unit) {
        return rejected(`unit mismatch: ${left.unit} ${OPERATOR_SYMBOLS[node]} ${right.unit} in ${label}`);
    }
    return evaluated(left.unit, node === 'add' ? left.value + right.value : left.value - right.value, label);
}

function evaluateScaling(
    node: 'mul' | 'div',
    left: TransformQuantity,
    right: TransformQuantity,
    label: string
): TransformExpressionResult {
    if (!DECLARATIVE_TRANSFORM_SCALING_UNITS.includes(right.unit)) {
        return rejected(
            `unit mismatch: ${left.unit} ${OPERATOR_SYMBOLS[node]} ${right.unit} in ${label}; a scaling factor is count or ratio`
        );
    }
    if (node === 'div' && right.value === 0) {
        return rejected(`division by zero in ${label}`);
    }
    return evaluated(left.unit, node === 'mul' ? left.value * right.value : left.value / right.value, label);
}

function evaluateFieldOfItem(
    expression: Extract<TransformExpression, { node: 'field' }>,
    context: TransformEvaluationContext
): TransformExpressionResult {
    const item = context.items.get(expression.item);
    if (!item) {
        return rejected(`unknown item "${expression.item}" in ${context.label}`);
    }
    if (!item.span) {
        return rejected(`field "${expression.field}" is not available on the ${item.target} item "${expression.item}"`);
    }
    if (expression.field === 'length') {
        return evaluated('beats', item.span.endBeat - item.span.startBeat, context.label);
    }
    return evaluated('beats', item.span[expression.field], context.label);
}

function evaluateConversion(
    node: 'secondsToBeats' | 'beatsToSeconds',
    source: TransformQuantity,
    context: TransformEvaluationContext
): TransformExpressionResult {
    const requiredUnit = node === 'secondsToBeats' ? 'seconds' : 'beats';
    if (source.unit !== requiredUnit) {
        return rejected(`unit mismatch: ${node} requires ${requiredUnit} but read ${source.unit} in ${context.label}`);
    }
    if (context.tempo <= 0 || !Number.isFinite(context.tempo)) {
        return rejected(`snapshot tempo ${String(context.tempo)} cannot convert time in ${context.label}`);
    }
    const beatsPerSecond = context.tempo / SECONDS_PER_MINUTE;
    if (node === 'secondsToBeats') {
        return evaluated('beats', source.value * beatsPerSecond, context.label);
    }
    return evaluated('seconds', source.value / beatsPerSecond, context.label);
}

function evaluateOperands(
    left: TransformExpression,
    right: TransformExpression,
    context: TransformEvaluationContext,
    depth: number
): { left: TransformQuantity; right: TransformQuantity } | TransformExpressionResult {
    const leftResult = evaluate(left, context, depth);
    if (leftResult.status === 'rejected') {
        return leftResult;
    }
    const rightResult = evaluate(right, context, depth);
    if (rightResult.status === 'rejected') {
        return rightResult;
    }
    return { left: leftResult.quantity, right: rightResult.quantity };
}

function isResult(
    value: { left: TransformQuantity; right: TransformQuantity } | TransformExpressionResult
): value is TransformExpressionResult {
    return 'status' in value;
}

function evaluateLeaf(
    expression: Extract<TransformExpression, { node: 'const' | 'var' | 'index' | 'field' }>,
    context: TransformEvaluationContext
): TransformExpressionResult {
    if (expression.node === 'const') {
        return evaluated(expression.quantity.unit, expression.quantity.value, context.label);
    }
    if (expression.node === 'var') {
        const quantity = context.variables.get(expression.name);
        if (!quantity) {
            return rejected(`unknown variable "${expression.name}" in ${context.label}`);
        }
        return { status: 'evaluated', quantity };
    }
    if (expression.node === 'index') {
        const item = context.items.get(expression.item);
        if (!item) {
            return rejected(`unknown item "${expression.item}" in ${context.label}`);
        }
        return evaluated('count', item.index, context.label);
    }
    return evaluateFieldOfItem(expression, context);
}

function evaluate(
    expression: TransformExpression,
    context: TransformEvaluationContext,
    depth: number
): TransformExpressionResult {
    if (depth > DECLARATIVE_TRANSFORM_MAX_EXPRESSION_DEPTH) {
        return rejected(
            `expression depth above the maximum ${String(DECLARATIVE_TRANSFORM_MAX_EXPRESSION_DEPTH)} in ${context.label}`
        );
    }
    if (
        expression.node === 'const' ||
        expression.node === 'var' ||
        expression.node === 'index' ||
        expression.node === 'field'
    ) {
        return evaluateLeaf(expression, context);
    }
    if (expression.node === 'secondsToBeats' || expression.node === 'beatsToSeconds') {
        const source = evaluate(expression.value, context, depth + 1);
        return source.status === 'rejected' ? source : evaluateConversion(expression.node, source.quantity, context);
    }
    if (expression.node === 'random') {
        const operands = evaluateOperands(expression.min, expression.max, context, depth + 1);
        if (isResult(operands)) {
            return operands;
        }
        if (operands.left.unit !== operands.right.unit) {
            return rejected(
                `unit mismatch: random ${operands.left.unit} to ${operands.right.unit} in ${context.label}`
            );
        }
        const span = operands.right.value - operands.left.value;
        return evaluated(operands.left.unit, operands.left.value + context.random() * span, context.label);
    }
    const operands = evaluateOperands(expression.left, expression.right, context, depth + 1);
    if (isResult(operands)) {
        return operands;
    }
    if (expression.node === 'add' || expression.node === 'sub') {
        return evaluateAdditive(expression.node, operands.left, operands.right, context.label);
    }
    return evaluateScaling(expression.node, operands.left, operands.right, context.label);
}

/** Evaluates one expression to a united quantity, or says which node and units refused it. */
export function evaluateTransformExpression(
    expression: TransformExpression,
    context: TransformEvaluationContext
): TransformExpressionResult {
    return evaluate(expression, context, 1);
}
