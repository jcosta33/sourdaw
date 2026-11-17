const unwrap = (node) => {
    let value = node;
    while (
        value?.type === 'AwaitExpression' ||
        value?.type === 'ChainExpression' ||
        value?.type === 'ParenthesizedExpression' ||
        value?.type === 'TSNonNullExpression' ||
        value?.type === 'TSSatisfiesExpression'
    ) {
        value = value.type === 'AwaitExpression' ? value.argument : value.expression;
    }
    return value;
};

const memberName = (member) => {
    if (member?.type !== 'MemberExpression') {
        return undefined;
    }
    return member.computed ? member.property.value : member.property.name;
};

const calledMember = (call, name) => call?.type === 'CallExpression' && memberName(call.callee) === name;
const isFunction = (node) => node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';
const isIdentifier = (node, name) => node?.type === 'Identifier' && node.name === name;

function variableForIdentifier(context, identifier) {
    if (identifier?.type !== 'Identifier') {
        return undefined;
    }
    for (let scope = context.sourceCode.getScope(identifier); scope; scope = scope.upper) {
        const variable = scope.set.get(identifier.name);
        if (variable) {
            return variable;
        }
    }
    return undefined;
}

function definitions(context, identifier) {
    return variableForIdentifier(context, identifier)?.defs ?? [];
}

const isGlobal = (context, node, name) => isIdentifier(node, name) && definitions(context, node).length === 0;

function isNamedImport(context, identifier, name, sourceMatches) {
    return definitions(context, identifier).some(
        (definition) =>
            definition.type === 'ImportBinding' &&
            definition.node.type === 'ImportSpecifier' &&
            (definition.node.imported.name ?? definition.node.imported.value) === name &&
            sourceMatches(definition.parent.source.value)
    );
}

function rule(description, create) {
    return { meta: { type: 'problem', docs: { description }, schema: [] }, create };
}

function catchCallback(call) {
    if (!calledMember(call, 'catch')) {
        return undefined;
    }
    const callback = call.arguments[0];
    return isFunction(callback) ? callback : undefined;
}

function handlerValue(body) {
    if (body.type !== 'BlockStatement') {
        return body;
    }
    if (body.body.length === 1 && body.body[0].type === 'ReturnStatement') {
        return body.body[0].argument;
    }
    return undefined;
}

function isEmptyHandler(context, body) {
    if (body.type === 'BlockStatement' && body.body.every((statement) => statement.type === 'EmptyStatement')) {
        return true;
    }
    const value = handlerValue(body);
    return (
        value === null ||
        isGlobal(context, value, 'undefined') ||
        (value?.type === 'UnaryExpression' && value.operator === 'void' && value.argument.type === 'Literal')
    );
}

const LOOP_STATEMENTS = new Set([
    'DoWhileStatement',
    'ForInStatement',
    'ForOfStatement',
    'ForStatement',
    'WhileStatement',
]);

function jumpStaysInside(node, statement) {
    for (let parent = node.parent; parent && parent !== statement.parent; parent = parent.parent) {
        if (node.label) {
            if (parent.type === 'LabeledStatement' && parent.label.name === node.label.name) {
                return true;
            }
        } else if (
            LOOP_STATEMENTS.has(parent.type) ||
            (node.type === 'BreakStatement' && parent.type === 'SwitchStatement')
        ) {
            return true;
        }
    }
    return false;
}

function rejectionExits(context, statements, returnsOriginal) {
    for (const statement of statements) {
        const exit = rejectionExit(context, statement, returnsOriginal);
        if (exit !== 'fallthrough') {
            return exit;
        }
    }
    return 'fallthrough';
}

function rejectionExit(context, statement, returnsOriginal) {
    switch (statement.type) {
        case 'ReturnStatement':
            return returnsOriginal(statement.argument) ? 'propagates' : 'discards';
        case 'ThrowStatement':
            return 'propagates';
        case 'BlockStatement':
            return rejectionExits(context, statement.body, returnsOriginal);
        case 'IfStatement': {
            const consequent = rejectionExit(context, statement.consequent, returnsOriginal);
            const alternate = statement.alternate
                ? rejectionExit(context, statement.alternate, returnsOriginal)
                : 'fallthrough';
            if (consequent === 'discards' || alternate === 'discards') {
                return 'discards';
            }
            return consequent === 'propagates' && alternate === 'propagates' ? 'propagates' : 'fallthrough';
        }
        default:
            // Other statement shapes may fall through. Inspect their exits without assuming that they execute.
            return hasSameFunctionNode(context, statement, (node) => {
                if (node.type === 'ReturnStatement') {
                    return !returnsOriginal(node.argument);
                }
                return (
                    (node.type === 'BreakStatement' || node.type === 'ContinueStatement') &&
                    !jumpStaysInside(node, statement)
                );
            })
                ? 'discards'
                : 'fallthrough';
    }
}

function leavesRejectionObservable(context, call) {
    const original = call.callee.object;
    if (original.type !== 'Identifier') {
        return false;
    }
    const ignored = call.parent.type === 'UnaryExpression' && call.parent.operator === 'void' ? call.parent : call;
    const statement = ignored.parent;
    if (statement.type !== 'ExpressionStatement' || statement.parent.type !== 'BlockStatement') {
        return false;
    }
    const siblings = statement.parent.body;
    const following = siblings.slice(siblings.indexOf(statement) + 1);
    // A cancellation branch can observe the losing rejection while still rejecting the caller.
    if (ignored !== call && following[0]?.type === 'ThrowStatement') {
        return true;
    }
    const variable = variableForIdentifier(context, original);
    const binding = variable?.defs[0];
    if (!binding) {
        return false;
    }
    const laterWrites = variable.references.filter(
        (reference) => reference.isWrite() && reference.identifier.range[0] >= call.range[1]
    );
    const returnsBinding = (value) =>
        isIdentifier(value, original.name) && definitions(context, value)[0]?.node === binding.node;
    function retainsRejectingValue(expression) {
        const value = unwrap(expression);
        if (returnsBinding(value)) {
            return true;
        }
        if (isGlobalPromiseCall(context, value, 'resolve')) {
            return retainsRejectingValue(value.arguments[0]);
        }
        return safePromiseContinuation(context, value) && retainsRejectingValue(value.callee.object);
    }
    function returnsOriginal(argument) {
        if (!argument || laterWrites.some((reference) => reference.identifier.range[0] < argument.range[1])) {
            return false;
        }
        const value = unwrap(argument);
        if (value?.type === 'ObjectExpression') {
            return value.properties.some(
                (property) =>
                    property.type === 'Property' && property.kind === 'init' && retainsRejectingValue(property.value)
            );
        }
        const joined =
            promiseArrayArguments(context, value, 'all') ?? promiseArrayArguments(context, value, 'allSettled');
        if (joined) {
            return joined.elements.some(retainsRejectingValue);
        }
        return retainsRejectingValue(value);
    }
    return rejectionExits(context, following, returnsOriginal) === 'propagates';
}

const noSilentCatch = rule(
    'Require an error handler to act on an error or leave the original rejection observable.',
    (context) => {
        const report = (node) =>
            context.report({
                node,
                message: 'Handle or rethrow the error. An empty handler discards the failure.',
            });
        return {
            CatchClause(node) {
                if (isEmptyHandler(context, node.body)) {
                    report(node);
                }
            },
            CallExpression(node) {
                const callback = catchCallback(node);
                if (callback && isEmptyHandler(context, callback.body) && !leavesRejectionObservable(context, node)) {
                    report(callback);
                }
            },
        };
    }
);

function successRuntimeValue(node) {
    let value = unwrap(node);
    while (value?.type === 'TSAsExpression' || value?.type === 'TSTypeAssertion') {
        value = unwrap(value.expression);
    }
    return value;
}

const isTrue = (node) => {
    const value = successRuntimeValue(node);
    return value?.type === 'Literal' && value.value === true;
};

function isSuccessValue(node) {
    const value = successRuntimeValue(node);
    return (
        value?.type === 'ObjectExpression' &&
        value.properties.some(
            (property) =>
                property.type === 'Property' &&
                !property.computed &&
                ['ok', 'success'].includes(property.key.name ?? property.key.value) &&
                isTrue(property.value)
        )
    );
}

function unconditionalSuccess(body) {
    if (body.type !== 'BlockStatement') {
        return isSuccessValue(body) ? body : undefined;
    }
    const terminal = body.body.at(-1);
    if (terminal?.type !== 'ReturnStatement' || !isSuccessValue(terminal.argument)) {
        return undefined;
    }
    const onlyLogsBeforeReturn = body.body.slice(0, -1).every((statement) => {
        const call = statement.expression;
        return (
            statement.type === 'ExpressionStatement' &&
            call.type === 'CallExpression' &&
            isIdentifier(call.callee.object, 'console') &&
            ['error', 'warn', 'info', 'log', 'debug'].includes(memberName(call.callee))
        );
    });
    return onlyLogsBeforeReturn ? terminal.argument : undefined;
}

const noFailedOperationSuccess = rule('Reject unconditional success results from error handlers.', (context) => {
    function check(body) {
        const value = unconditionalSuccess(body);
        if (value) {
            context.report({
                node: value,
                message:
                    'A failed operation cannot unconditionally return success. Propagate the failure or recover explicitly.',
            });
        }
    }
    return {
        CatchClause: (node) => check(node.body),
        CallExpression(node) {
            const callback = catchCallback(node);
            if (callback) {
                check(callback.body);
            }
        },
    };
});

function isFetch(context, node) {
    const call = unwrap(node);
    return call?.type === 'CallExpression' && isGlobal(context, call.callee, 'fetch');
}

function isWebResponse(context, receiver) {
    if (isFetch(context, receiver)) {
        return true;
    }
    const value = unwrap(receiver);
    const [definition, another] = definitions(context, value);
    if (!definition || another) {
        return false;
    }
    const annotation = definition.name.typeAnnotation?.typeAnnotation;
    if (annotation?.type === 'TSTypeReference' && isGlobal(context, annotation.typeName, 'Response')) {
        return true;
    }
    return (
        definition.type === 'Variable' && definition.parent.kind === 'const' && isFetch(context, definition.node.init)
    );
}

function isExternalCall(context, node) {
    const call = unwrap(node);
    if (calledMember(call, 'parse') && isGlobal(context, call.callee.object, 'JSON')) {
        return true;
    }
    if (calledMember(call, 'json') && isWebResponse(context, call.callee.object)) {
        return true;
    }
    return (
        call?.type === 'CallExpression' &&
        isNamedImport(context, call.callee, 'desktopInvoke', (source) =>
            /(?:^|\/)utils\/desktopBridge(?:\.ts)?$/.test(source)
        )
    );
}

const noExternalDataAssertion = rule(
    'Require runtime validation before interpreting directly read external data.',
    (context) => {
        function check(node) {
            const type = node.typeAnnotation;
            if (
                type.type === 'TSUnknownKeyword' ||
                (type.type === 'TSTypeReference' && isIdentifier(type.typeName, 'const'))
            ) {
                return;
            }
            if (isExternalCall(context, node.expression)) {
                context.report({
                    node,
                    message:
                        'Validate external data before assigning it a domain type. Keep the raw value unknown until it is checked.',
                });
            }
        }
        return { TSAsExpression: check, TSTypeAssertion: check };
    }
);

const playwrightImport = (source) => source === '@playwright/test' || /(?:^|\/)e2eTest(?:\.ts)?$/.test(source);

function playwrightBinding(context, node, name) {
    return isNamedImport(context, node, name, playwrightImport);
}

function playwrightTestCallback(context, call) {
    const callee = call.callee;
    const isCase =
        playwrightBinding(context, callee, 'test') ||
        (['only', 'skip', 'fixme', 'fail'].includes(memberName(callee)) &&
            playwrightBinding(context, callee.object, 'test'));
    if (!isCase) {
        return undefined;
    }
    const callback = call.arguments.at(-1);
    return isFunction(callback) && callback.body.type === 'BlockStatement' ? callback : undefined;
}

function enclosingFunction(node) {
    let parent = node.parent;
    while (parent && !isFunction(parent) && parent.type !== 'FunctionDeclaration') {
        parent = parent.parent;
    }
    return parent;
}

const ERASED_EXPRESSION_WRAPPERS = new Set([
    'ParenthesizedExpression',
    'TSAsExpression',
    'TSNonNullExpression',
    'TSSatisfiesExpression',
    'TSTypeAssertion',
]);

function isAwaitedThroughErasedWrappers(expression) {
    let value = expression;
    while (value.parent?.expression === value && ERASED_EXPRESSION_WRAPPERS.has(value.parent.type)) {
        value = value.parent;
    }
    return value.parent?.type === 'AwaitExpression' && value.parent.argument === value;
}

function isAwaitedPlaywrightStep(context, callback) {
    if (!isFunction(callback)) {
        return false;
    }
    const call = callback.parent;
    return (
        calledMember(call, 'step') &&
        call.arguments[1] === callback &&
        isAwaitedThroughErasedWrappers(call) &&
        playwrightBinding(context, call.callee.object, 'test')
    );
}

function visibilityCondition(context, test) {
    const value = unwrap(test);
    const negated = value?.type === 'UnaryExpression' && value.operator === '!';
    let call = negated ? unwrap(value.argument) : value;
    if (call?.type === 'Identifier') {
        const [definition, another] = definitions(context, call);
        if (another || definition?.type !== 'Variable' || definition.parent.kind !== 'const') {
            return undefined;
        }
        call = unwrap(definition.node.init);
    }
    if (calledMember(call, 'catch')) {
        call = unwrap(call.callee.object);
    }
    return calledMember(call, 'isVisible') ? { negated } : undefined;
}

function silentReturn(statement) {
    const body = statement.type === 'BlockStatement' ? statement.body : [statement];
    return body.length === 1 && body[0].type === 'ReturnStatement' && body[0].argument === null;
}

function assertionGuard(context, statement, assertions) {
    if (statement.type !== 'IfStatement' || statement.alternate) {
        return false;
    }
    const condition = visibilityCondition(context, statement.test);
    if (!condition) {
        return false;
    }
    if (condition.negated) {
        return silentReturn(statement.consequent) && assertions.every((node) => node.range[0] >= statement.range[1]);
    }
    const [start, end] = statement.consequent.range;
    return assertions.every((node) => node.range[0] >= start && node.range[1] <= end);
}

const noConditionalPlaywrightAdmission = rule(
    'Require Playwright assertions to be reachable when a required locator is absent.',
    (context) => {
        const assertionsByCallback = new Map();

        function recordAssertion(node) {
            let owner = enclosingFunction(node);
            while (isAwaitedPlaywrightStep(context, owner)) {
                owner = enclosingFunction(owner);
            }
            assertionsByCallback.get(owner)?.push(node);
        }

        return {
            CallExpression(node) {
                const callback = playwrightTestCallback(context, node);
                if (callback) {
                    assertionsByCallback.set(callback, []);
                    return;
                }
                if (
                    playwrightBinding(context, node.callee, 'expect') ||
                    (['poll', 'soft'].includes(memberName(node.callee)) &&
                        playwrightBinding(context, node.callee.object, 'expect'))
                ) {
                    recordAssertion(node);
                }
            },
            'Program:exit'() {
                for (const [callback, assertions] of assertionsByCallback) {
                    if (assertions.length === 0) {
                        continue;
                    }
                    const guard = callback.body.body.find((statement) =>
                        assertionGuard(context, statement, assertions)
                    );
                    if (guard) {
                        context.report({
                            node: guard,
                            message:
                                'This test can finish without asserting when the locator is absent. Assert or wait for the required locator unconditionally.',
                        });
                    }
                }
            },
        };
    }
);

function isInlineTimeout(context, expression) {
    if (expression?.type !== 'NewExpression' || !isGlobal(context, expression.callee, 'Promise')) {
        return false;
    }
    const executor = expression.arguments[0];
    if (!isFunction(executor) || executor.params[0]?.type !== 'Identifier') {
        return false;
    }
    let call = executor.body;
    if (call.type === 'BlockStatement' && call.body.length === 1) {
        const statement = call.body[0];
        call = statement.type === 'ReturnStatement' ? statement.argument : statement.expression;
    }
    if (call?.type !== 'CallExpression' || call.arguments.length < 2) {
        return false;
    }
    const timer = call.callee;
    if (
        !isGlobal(context, timer, 'setTimeout') &&
        !(
            memberName(timer) === 'setTimeout' &&
            ['window', 'globalThis'].some((name) => isGlobal(context, timer.object, name))
        )
    ) {
        return false;
    }
    const completion = call.arguments[0];
    if (isIdentifier(completion, executor.params[0].name)) {
        return true;
    }
    const completionCall = isFunction(completion) ? completion.body : undefined;
    return completionCall?.type === 'CallExpression' && isIdentifier(completionCall.callee, executor.params[0].name);
}

const noFixedTestSleep = rule(
    'Require tests to synchronize on an observable instead of an elapsed delay.',
    (context) => {
        const report = (node) =>
            context.report({
                node,
                message: 'Wait for an observable outcome instead of sleeping for a fixed duration.',
            });
        function checkTimer(node, expression) {
            // An explicit await in a return or arrow is checked by the await visitor.
            if (expression?.type === 'AwaitExpression') {
                return;
            }
            const value = unwrap(expression);
            if (
                isInlineTimeout(context, value) ||
                (value?.type === 'CallExpression' &&
                    isNamedImport(
                        context,
                        value.callee,
                        'setTimeout',
                        (source) => source === 'node:timers/promises' || source === 'timers/promises'
                    ))
            ) {
                report(node);
            }
        }
        return {
            CallExpression(node) {
                if (calledMember(node, 'waitForTimeout')) {
                    report(node);
                }
            },
            AwaitExpression(node) {
                checkTimer(node, node.argument);
            },
            ReturnStatement(node) {
                checkTimer(node, node.argument);
            },
            ArrowFunctionExpression(node) {
                checkTimer(node, node.body);
            },
        };
    }
);

// Chai installs these terminal properties as assertions rather than methods.
const CHAI_ASSERTION_GETTERS = new Set([
    'Arguments',
    'NaN',
    'arguments',
    'empty',
    'exist',
    'extensible',
    'false',
    'finite',
    'frozen',
    'null',
    'ok',
    'sealed',
    'true',
    'undefined',
]);

function vitestExpectKind(context, call) {
    const imported = (node) => isNamedImport(context, node, 'expect', (source) => source === 'vitest');
    if (imported(call.callee)) {
        return 'expect';
    }
    const name = memberName(call.callee);
    return ['soft', 'poll'].includes(name) && imported(call.callee.object) ? name : undefined;
}

function assertionEnd(call) {
    let current = call;
    let asynchronous = false;
    while (current.parent?.type === 'MemberExpression' && current.parent.object === current) {
        current = current.parent;
        if (['rejects', 'resolves'].includes(memberName(current))) {
            asynchronous = true;
        }
        if (current.parent?.type === 'CallExpression' && current.parent.callee === current) {
            return { expression: current.parent, asynchronous, valid: true };
        }
    }
    return { expression: current, asynchronous, valid: CHAI_ASSERTION_GETTERS.has(memberName(current)) };
}

function safePromiseContinuation(context, call) {
    if (calledMember(call, 'finally')) {
        return true;
    }
    if (calledMember(call, 'then')) {
        const onRejected = call.arguments[1];
        return onRejected === undefined || onRejected?.value === null || isGlobal(context, onRejected, 'undefined');
    }
    return false;
}

function isGlobalPromiseCall(context, call, method) {
    return calledMember(call, method) && isGlobal(context, call.callee.object, 'Promise');
}

function promiseArrayArguments(context, call, method) {
    if (!isGlobalPromiseCall(context, call, method)) {
        return undefined;
    }
    const values = call.arguments[0];
    return values?.type === 'ArrayExpression' ? values : undefined;
}

function observationExpression(context, assertion) {
    let current = assertion;
    while (current.parent) {
        const parent = current.parent;
        if (parent.type === 'ArrayExpression' && promiseArrayArguments(context, parent.parent, 'all') === parent) {
            current = parent.parent;
            continue;
        }
        if (parent.type === 'MemberExpression' && parent.object === current && parent.parent?.callee === parent) {
            const continuation = parent.parent;
            if (safePromiseContinuation(context, continuation)) {
                current = continuation;
                continue;
            }
        }
        break;
    }
    return current;
}

function consumesBinding(context, expression, declaration) {
    const value = unwrap(expression);
    if (isIdentifier(value, declaration.id.name)) {
        return definitions(context, value)[0]?.node === declaration;
    }
    const array = promiseArrayArguments(context, value, 'all');
    if (array) {
        return array.elements.some((element) => consumesBinding(context, element, declaration));
    }
    return safePromiseContinuation(context, value) && consumesBinding(context, value.callee.object, declaration);
}

function hasSameFunctionNode(context, node, predicate) {
    if (isFunction(node) || node.type === 'FunctionDeclaration') {
        return false;
    }
    if (predicate(node)) {
        return true;
    }
    return (context.sourceCode.visitorKeys[node.type] ?? []).some((key) => {
        const child = node[key];
        if (Array.isArray(child)) {
            return child.some((value) => value && hasSameFunctionNode(context, value, predicate));
        }
        return child && hasSameFunctionNode(context, child, predicate);
    });
}

function maySkipObservation(context, node) {
    return hasSameFunctionNode(context, node, (current) =>
        ['ReturnStatement', 'BreakStatement', 'ContinueStatement'].includes(current.type)
    );
}

function capturedAssertionObserved(context, assertion) {
    const declaration = assertion.parent;
    if (declaration?.type !== 'VariableDeclarator' || declaration.id.type !== 'Identifier') {
        return false;
    }
    const statement = declaration.parent;
    if (statement.kind !== 'const' || statement.parent.type !== 'BlockStatement') {
        return false;
    }
    const siblings = statement.parent.body;
    for (const following of siblings.slice(siblings.indexOf(statement) + 1)) {
        if (following.type === 'ExpressionStatement' && following.expression.type === 'AwaitExpression') {
            if (consumesBinding(context, following.expression.argument, declaration)) {
                return true;
            }
        }
        if (following.type === 'ReturnStatement') {
            return consumesBinding(context, following.argument, declaration);
        }
        if (maySkipObservation(context, following)) {
            return false;
        }
    }
    return false;
}

function assertionObserved(context, expression) {
    const assertion = observationExpression(context, expression);
    const parent = assertion.parent;
    return (
        parent?.type === 'AwaitExpression' ||
        parent?.type === 'ReturnStatement' ||
        (parent?.type === 'ArrowFunctionExpression' && parent.body === assertion) ||
        capturedAssertionObserved(context, assertion)
    );
}

const noInvalidVitestExpect = rule(
    'Require a matcher and observable completion for imported Vitest assertions.',
    (context) => ({
        CallExpression(node) {
            const kind = vitestExpectKind(context, node);
            if (kind === undefined) {
                return;
            }
            if (node.arguments.length < 1 || node.arguments.length > 2) {
                context.report({
                    node,
                    message: 'Vitest expect needs a subject and accepts one optional message or options argument.',
                });
                return;
            }
            const { expression, asynchronous, valid } = assertionEnd(node);
            if (!valid) {
                context.report({ node: expression, message: 'Complete the Vitest expect assertion with a matcher.' });
                return;
            }
            if ((kind === 'poll' || asynchronous) && !assertionObserved(context, expression)) {
                context.report({
                    node: expression,
                    message: 'Await or return the Vitest assertion so its rejection reaches the test.',
                });
            }
        },
    })
);

export const qualityRules = {
    'no-conditional-playwright-admission': noConditionalPlaywrightAdmission,
    'no-external-data-assertion': noExternalDataAssertion,
    'no-failed-operation-success': noFailedOperationSuccess,
    'no-fixed-test-sleep': noFixedTestSleep,
    'no-invalid-vitest-expect': noInvalidVitestExpect,
    'no-silent-catch': noSilentCatch,
};
