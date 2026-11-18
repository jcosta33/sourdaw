/**
 * Oxlint JS plugin: agent JS-isms native oxlint does not catch.
 * Messages tell the author the fix. `{ ...record, field }` and `fn(...args)` stay legal.
 */

import { qualityRules } from './qualityRules.mjs';

const ARRAY_PIPELINE_METHODS = new Set(['map', 'filter', 'sort', 'flatMap', 'reduce']);

const unwrap = (node) => {
    let current = node;
    while (current) {
        if (
            current.type === 'ParenthesizedExpression' ||
            current.type === 'TSAsExpression' ||
            current.type === 'TSSatisfiesExpression' ||
            current.type === 'TSNonNullExpression' ||
            current.type === 'ChainExpression'
        ) {
            current = current.expression;
            continue;
        }
        break;
    }
    return current;
};

const propertyName = (node) => {
    if (!node || node.type !== 'MemberExpression' || node.computed) {
        return undefined;
    }
    if (node.property.type === 'Identifier') {
        return node.property.name;
    }
    if (node.property.type === 'Literal' && typeof node.property.value === 'string') {
        return node.property.value;
    }
    return undefined;
};

const isJsonMember = (node, name) => {
    const member = unwrap(node);
    return Boolean(
        member &&
        member.type === 'MemberExpression' &&
        member.object?.type === 'Identifier' &&
        member.object.name === 'JSON' &&
        propertyName(member) === name
    );
};

const isArrayPipelineCall = (node) => {
    const call = unwrap(node);
    if (!call || call.type !== 'CallExpression') {
        return false;
    }
    const name = propertyName(unwrap(call.callee));
    return Boolean(name && ARRAY_PIPELINE_METHODS.has(name));
};

const pipelineLength = (node) => {
    let length = 0;
    let current = unwrap(node);
    while (isArrayPipelineCall(current)) {
        length += 1;
        current = unwrap(current.callee)?.object;
    }
    return length;
};

const isInnerPipelineStep = (node) => {
    const parent = unwrap(node.parent);
    if (!parent || parent.type !== 'MemberExpression') {
        return false;
    }
    return isArrayPipelineCall(parent.parent);
};

const isJsxNode = (node) =>
    Boolean(
        node &&
        (node.type === 'JSXElement' ||
            node.type === 'JSXFragment' ||
            node.type === 'JSXExpressionContainer' ||
            node.type === 'JSXAttribute' ||
            node.type === 'JSXSpreadChild' ||
            node.type === 'JSXSpreadAttribute')
    );

const getAncestors = (context, node) => {
    if (typeof context.sourceCode?.getAncestors === 'function') {
        return context.sourceCode.getAncestors(node);
    }
    const ancestors = [];
    let current = node.parent;
    while (current) {
        ancestors.push(current);
        current = current.parent;
    }
    return ancestors;
};

const isSimpleValue = (node) => {
    const value = unwrap(node);
    if (!value) {
        return false;
    }
    if (value.type === 'Literal' || value.type === 'Identifier' || value.type === 'TemplateLiteral') {
        return true;
    }
    if (value.type === 'MemberExpression') {
        return isSimpleValue(value.object) && (value.computed ? isSimpleValue(value.property) : true);
    }
    if (
        value.type === 'UnaryExpression' &&
        (value.operator === '-' || value.operator === '+' || value.operator === '!')
    ) {
        return isSimpleValue(value.argument);
    }
    return isJsxNode(value);
};

const isMultiline = (context, node) => {
    if (node.loc?.start && node.loc.end) {
        return node.loc.start.line !== node.loc.end.line;
    }
    return context.sourceCode.getText(node).includes('\n');
};

const reportConditionalOrLogicalSpread = (context, node) => {
    const argument = unwrap(node.argument);
    if (!argument) {
        return;
    }
    if (argument.type !== 'ConditionalExpression' && argument.type !== 'LogicalExpression') {
        return;
    }
    context.report({
        node,
        message:
            'Do not spread a conditional or logical expression. Assign extra keys with `if`, or build a named object. `...(cond ? { k: v } : {})` is slop.',
    });
};

const noConditionalEmptySpread = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow spreading a conditional or logical expression, including empty object/array fallbacks.',
        },
        schema: [],
    },
    create(context) {
        return {
            SpreadElement(node) {
                reportConditionalOrLogicalSpread(context, node);
            },
            JSXSpreadAttribute(node) {
                reportConditionalOrLogicalSpread(context, node);
            },
        };
    },
};

const noUselessCloneSpread = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow `{ ...x }` with no added keys.',
        },
        schema: [],
    },
    create(context) {
        return {
            ObjectExpression(node) {
                if (node.properties.length !== 1) {
                    return;
                }
                const only = node.properties[0];
                if (only.type !== 'SpreadElement') {
                    return;
                }
                context.report({
                    node,
                    message:
                        'Do not clone with `{ ...x }`. Pass `x`, or add the keys you are changing: `{ ...record, field }`.',
                });
            },
        };
    },
};

const noSpreadCloneArrayMethod = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow `[...arr].map` / `[...arr].filter` — the method already copies.',
        },
        schema: [],
    },
    create(context) {
        return {
            CallExpression(node) {
                const callee = unwrap(node.callee);
                const name = propertyName(callee);
                if (name !== 'map' && name !== 'filter') {
                    return;
                }
                const object = unwrap(callee?.object);
                if (!object || object.type !== 'ArrayExpression' || object.elements.length !== 1) {
                    return;
                }
                const only = object.elements[0];
                if (!only || only.type !== 'SpreadElement') {
                    return;
                }
                context.report({
                    node,
                    message: `Do not clone with spread before \`.${name}\`. \`.${name}\` already returns a new array — call it on the original.`,
                });
            },
        };
    },
};

const noJsonParseStringify = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow JSON.parse(JSON.stringify(...)) clones.',
        },
        schema: [],
    },
    create(context) {
        return {
            CallExpression(node) {
                if (!isJsonMember(node.callee, 'parse') || node.arguments.length === 0) {
                    return;
                }
                const inner = unwrap(node.arguments[0]);
                if (!inner || inner.type !== 'CallExpression' || !isJsonMember(inner.callee, 'stringify')) {
                    return;
                }
                context.report({
                    node,
                    message:
                        'Do not clone with JSON.parse(JSON.stringify(...)). Use structuredClone, or the owning Automerge/CRDT path.',
                });
            },
        };
    },
};

const noLongArrayChain = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow three or more chained map/filter/sort/flatMap/reduce calls.',
        },
        schema: [],
    },
    create(context) {
        return {
            CallExpression(node) {
                if (pipelineLength(node) < 3 || isInnerPipelineStep(node)) {
                    return;
                }
                context.report({
                    node,
                    message:
                        'Do not chain three or more .map/.filter/.sort/.flatMap/.reduce calls. Bind each step to a named binding.',
                });
            },
        };
    },
};

const FUNCTION_NODES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

const isBranchCall = (node) =>
    node.type === 'CallExpression' || (node.type === 'AwaitExpression' && node.argument.type === 'CallExpression');

const fixStatementTernary = (context, node, statement, fixer) => {
    const block = statement.parent;
    if (
        block.type !== 'BlockStatement' ||
        !FUNCTION_NODES.has(block.parent.type) ||
        isMultiline(context, statement) ||
        statement.range[0] !== node.test.range[0] ||
        !isBranchCall(node.consequent) ||
        !isBranchCall(node.alternate)
    ) {
        return null;
    }

    const source = context.sourceCode;
    const between = (left, right) => source.text.slice(left.range[1], right.range[0]).trim();
    if (
        between(node.test, node.consequent) !== '?' ||
        between(node.consequent, node.alternate) !== ':' ||
        source.text.slice(node.alternate.range[1], statement.range[1]).trim() !== ';' ||
        source.getCommentsBefore(statement).length > 0 ||
        source.getCommentsInside(statement).length > 0 ||
        source.getCommentsAfter(statement).some((comment) => comment.loc.start.line === statement.loc.end.line)
    ) {
        return null;
    }

    const test = source.getText(node.test);
    const consequent = source.getText(node.consequent);
    const alternate = source.getText(node.alternate);
    // A call starting with a class, function or object expression needs grouping in statement position.
    return fixer.replaceText(statement, `if (${test}) { (${consequent}); } else { (${alternate}); }`);
};

const noControlFlowTernary = {
    meta: {
        type: 'problem',
        fixable: 'code',
        docs: {
            description: 'Disallow ternaries used as if/else. Simple values and JSX remain allowed.',
        },
        schema: [],
    },
    create(context) {
        return {
            ConditionalExpression(node) {
                if (getAncestors(context, node).some(isJsxNode)) {
                    return;
                }
                const parent = unwrap(node.parent);
                if (parent?.type === 'ExpressionStatement') {
                    context.report({
                        node,
                        message: 'Do not use a ternary as a statement. Use `if` / `else`.',
                        fix: (fixer) => fixStatementTernary(context, node, parent, fixer),
                    });
                    return;
                }
                if (isSimpleValue(node.consequent) && isSimpleValue(node.alternate)) {
                    return;
                }
                if (isJsxNode(unwrap(node.consequent)) && isJsxNode(unwrap(node.alternate))) {
                    return;
                }
                if (!isMultiline(context, node)) {
                    return;
                }
                context.report({
                    node,
                    message:
                        'Do not use a ternary as an if. Keep `cond ? value : value` or JSX `cond ? <A /> : <B />`; use `if` for statements and calls.',
                });
            },
        };
    },
};

const plugin = {
    meta: {
        name: 'sourdaw-craft',
    },
    rules: {
        'no-conditional-empty-spread': noConditionalEmptySpread,
        'no-useless-clone-spread': noUselessCloneSpread,
        'no-spread-clone-array-method': noSpreadCloneArrayMethod,
        'no-json-parse-stringify': noJsonParseStringify,
        'no-long-array-chain': noLongArrayChain,
        'no-control-flow-ternary': noControlFlowTernary,
        ...qualityRules,
    },
};

export default plugin;
