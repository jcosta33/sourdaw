/**
 * Oxlint JS plugin: agent JS-isms native oxlint does not catch.
 * Messages tell the author the fix. `{ ...record, field }` and `fn(...args)` stay legal.
 */

import { hasSameFunctionNode, qualityRules } from './qualityRules.mjs';

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

const isCall = (node) =>
    node.type === 'CallExpression' || (node.type === 'ChainExpression' && node.expression.type === 'CallExpression');

const isAwaitedCall = (node) => node.type === 'AwaitExpression' && isCall(node.argument);

const isLocalVoidCall = (source, callee, block) => {
    const scope = source.getScope(callee);
    const variable = scope.references.find((reference) => reference.identifier === callee)?.resolved;
    if (variable?.defs.length !== 1 || variable.references.some((reference) => reference.isWrite())) {
        return false;
    }
    const declaration = variable.defs[0].node;
    if (
        declaration.type !== 'FunctionDeclaration' ||
        declaration.parent !== block ||
        !declaration.body ||
        declaration.async ||
        declaration.generator
    ) {
        return false;
    }
    if (declaration.returnType) {
        return declaration.returnType.typeAnnotation.type === 'TSVoidKeyword';
    }
    const body = declaration.body.body;
    return (
        body.length === 1 &&
        body[0].type === 'ExpressionStatement' &&
        source.getCommentsBefore(declaration).length === 0
    );
};

const isStatementBranch = (source, node, block) => {
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression' || isAwaitedCall(node)) {
        return true;
    }
    // Formatting removes grouping. A bare call can then acquire TypeScript assertion or never flow effects.
    return (
        node.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        isLocalVoidCall(source, node.callee, block)
    );
};

const fixTernary = (context, node, statement, fixer) => {
    const block = statement.parent;
    if (block.type !== 'BlockStatement' || !FUNCTION_NODES.has(block.parent.type)) {
        return null;
    }

    const source = context.sourceCode;
    const returnsValue = statement.type === 'ReturnStatement';
    if (returnsValue && (!block.parent.returnType || block.parent.generator)) {
        return null;
    }
    const isEligibleBranch = returnsValue
        ? (branch) => isCall(branch) || isAwaitedCall(branch)
        : (branch) => isStatementBranch(source, branch, block);
    const prefix = source.text.slice(statement.range[0], node.test.range[0]);
    const beforeConsequent = source.text.slice(node.test.range[1], node.consequent.range[0]);
    const beforeAlternate = source.text.slice(node.consequent.range[1], node.alternate.range[0]);
    const terminator = source.text.slice(node.alternate.range[1], statement.range[1]);
    if (
        (returnsValue ? prefix.trim() !== 'return' : prefix !== '') ||
        beforeConsequent.trim() !== '?' ||
        beforeAlternate.trim() !== ':' ||
        terminator.trim() !== ';' ||
        source.getCommentsBefore(statement).length > 0 ||
        source.getCommentsInside(statement).length > 0 ||
        source.getCommentsAfter(statement).some((comment) => comment.loc.start.line === statement.loc.end.line) ||
        !isEligibleBranch(node.consequent) ||
        !isEligibleBranch(node.alternate)
    ) {
        return null;
    }

    const test = source.getText(node.test);
    const branchPrefix = returnsValue ? 'return ' : '';
    // Preserve branch grouping and the original line breaks, including those before the semicolon.
    const consequent = `${branchPrefix}(${source.getText(node.consequent)})`;
    const alternate = `${branchPrefix}(${source.getText(node.alternate)})`;
    const openConsequent = beforeConsequent.replace('?', '{');
    const guarded = `if (${test})${openConsequent}${consequent}; }`;
    if (returnsValue) {
        const beforeReturn = beforeAlternate.replace(/:[ \t]?/u, '') || ' ';
        return fixer.replaceText(statement, `${guarded}${beforeReturn}${alternate}${terminator}`);
    }
    const openAlternate = beforeAlternate.replace(':', 'else {');
    return fixer.replaceText(statement, `${guarded}${openAlternate}${alternate}${terminator} }`);
};

function isControlFlowTernary(context, node, parent) {
    if (getAncestors(context, node).some(isJsxNode)) {
        return false;
    }
    if (parent?.type === 'ExpressionStatement') {
        return true;
    }
    if (isSimpleValue(node.consequent) && isSimpleValue(node.alternate)) {
        return false;
    }
    return isMultiline(context, node);
}

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
                const parent = unwrap(node.parent);
                if (!isControlFlowTernary(context, node, parent)) {
                    return;
                }
                if (parent.type === 'ExpressionStatement') {
                    context.report({
                        node,
                        message: 'Do not use a ternary as a statement. Use `if` / `else`.',
                        fix: (fixer) => fixTernary(context, node, parent, fixer),
                    });
                    return;
                }
                const canSplitReturn = parent.type === 'ReturnStatement' && parent.argument === node;
                context.report({
                    node,
                    message:
                        'Do not use a ternary as an if. Keep `cond ? value : value` or JSX `cond ? <A /> : <B />`; use `if` for statements and calls.',
                    fix: canSplitReturn ? (fixer) => fixTernary(context, node, parent, fixer) : undefined,
                });
            },
        };
    },
};

function hasSubstantialBranchWork(context, branch) {
    let calls = 0;
    return hasSameFunctionNode(context, branch, (node) => {
        if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
            return true;
        }
        if (node.type === 'CallExpression' || node.type === 'NewExpression') {
            calls += 1;
        }
        return calls >= 3;
    });
}

const noComplexTernaryBranch = {
    meta: {
        type: 'problem',
        fixable: 'code',
        docs: { description: 'Disallow substantial work in a ternary branch regardless of line breaks.' },
        schema: [],
    },
    create(context) {
        return {
            ConditionalExpression(node) {
                const parent = unwrap(node.parent);
                if (
                    isControlFlowTernary(context, node, parent) ||
                    ![node.consequent, node.alternate].some((branch) => hasSubstantialBranchWork(context, branch))
                ) {
                    return;
                }
                const canSplitReturn = parent.type === 'ReturnStatement' && parent.argument === node;
                context.report({
                    node,
                    message: 'Move the branch computation or mutation into explicit if/else control flow.',
                    fix: canSplitReturn ? (fixer) => fixTernary(context, node, parent, fixer) : undefined,
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
        'no-complex-ternary-branch': noComplexTernaryBranch,
        ...qualityRules,
    },
};

export default plugin;
