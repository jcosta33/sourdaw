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

function jumpTarget(node, boundary) {
    for (let parent = node.parent; parent && parent !== boundary; parent = parent.parent) {
        if (node.label) {
            if (parent.type === 'LabeledStatement' && parent.label.name === node.label.name) {
                return parent;
            }
        } else if (
            LOOP_STATEMENTS.has(parent.type) ||
            (node.type === 'BreakStatement' && parent.type === 'SwitchStatement')
        ) {
            return parent;
        }
    }
    return undefined;
}

function jumpStaysInside(node, statement) {
    return jumpTarget(node, statement.parent) !== undefined;
}

function throwIsHandledInsideFinalizer(context, statement, finalizer) {
    for (let child = statement; child !== finalizer; child = child.parent) {
        const parent = child.parent;
        if (
            parent.type === 'TryStatement' &&
            parent.block === child &&
            parent.handler &&
            !hasSameFunctionNode(context, parent.handler.body, (node) => node.type === 'ThrowStatement')
        ) {
            return true;
        }
    }
    return false;
}

function finalizerCanReplaceCompletion(context, finalizer, replacesThrow) {
    return hasSameFunctionNode(context, finalizer, (node) => {
        if (node.type === 'ReturnStatement') {
            return true;
        }
        if (node.type === 'ThrowStatement') {
            return !throwIsHandledInsideFinalizer(context, node, finalizer) && replacesThrow(node);
        }
        return (
            (node.type === 'BreakStatement' || node.type === 'ContinueStatement') && !jumpStaysInside(node, finalizer)
        );
    });
}

function completionInterruption(
    context,
    statement,
    { handlerIntercepts = () => statement.type === 'ThrowStatement', replacesThrow = () => true } = {}
) {
    const owner = enclosingFunction(statement);
    let child = statement;
    for (let parent = child.parent; parent && parent !== owner; parent = parent.parent) {
        if (parent.type === 'TryStatement') {
            if (parent.block === child && parent.handler && handlerIntercepts(parent.handler)) {
                return parent.handler;
            }
            const finalizer = parent.finalizer;
            if (finalizer && finalizer !== child && finalizerCanReplaceCompletion(context, finalizer, replacesThrow)) {
                return finalizer;
            }
        }
        child = parent;
    }
    return undefined;
}

function completionReachesCaller(context, statement, options) {
    return completionInterruption(context, statement, options) === undefined;
}

function throwExposesFailure(context, statement, failureSkipsReturn) {
    return (
        !hasSameFunctionNode(context, statement.argument, failureSkipsReturn) &&
        completionReachesCaller(context, statement)
    );
}

function rejectionExits(context, statements, proof) {
    for (const statement of statements) {
        const exit = rejectionExit(context, statement, proof);
        if (exit !== 'fallthrough') {
            return exit;
        }
    }
    return 'fallthrough';
}

function rejectionExit(context, statement, proof) {
    const { returnsOriginal, failureSkipsReturn } = proof;
    switch (statement.type) {
        case 'ReturnStatement':
            return returnsOriginal(statement) ? 'propagates' : 'discards';
        case 'ThrowStatement':
            return throwExposesFailure(context, statement, failureSkipsReturn) ? 'propagates' : 'discards';
        case 'BlockStatement':
            return rejectionExits(context, statement.body, proof);
        case 'IfStatement': {
            if (hasSameFunctionNode(context, statement.test, failureSkipsReturn)) {
                return 'discards';
            }
            const consequent = rejectionExit(context, statement.consequent, proof);
            const alternate = statement.alternate ? rejectionExit(context, statement.alternate, proof) : 'fallthrough';
            if (consequent === 'discards' || alternate === 'discards') {
                return 'discards';
            }
            return consequent === 'propagates' && alternate === 'propagates' ? 'propagates' : 'fallthrough';
        }
        default:
            // Other statement shapes may fall through. Inspect their exits without assuming that they execute.
            return hasSameFunctionNode(context, statement, (node) => {
                if (node.type === 'ReturnStatement') {
                    return !returnsOriginal(node);
                }
                return (
                    failureSkipsReturn(node) ||
                    ((node.type === 'BreakStatement' || node.type === 'ContinueStatement') &&
                        !jumpStaysInside(node, statement))
                );
            })
                ? 'discards'
                : 'fallthrough';
    }
}

function propertyName(property) {
    const key = withoutErasedWrappers(property.key);
    if (!property.computed && key.type === 'Identifier') {
        return key.name;
    }
    if (
        key.type === 'Literal' &&
        (key.value === null || ['string', 'number', 'bigint', 'boolean'].includes(typeof key.value))
    ) {
        return String(key.value);
    }
    if (key.type === 'TemplateLiteral' && key.expressions.length === 0) {
        return key.quasis[0].value.cooked;
    }
    return undefined;
}

function literalObjectFields(object, fields = new Map()) {
    for (const property of object.properties) {
        if (property.type === 'SpreadElement') {
            const spread = withoutErasedWrappers(property.argument);
            if (spread.type === 'ObjectExpression') {
                literalObjectFields(spread, fields);
            } else {
                fields.clear();
            }
            continue;
        }
        const name = propertyName(property);
        if (name === undefined) {
            fields.clear();
        } else if (property.kind !== 'init') {
            fields.delete(name);
        } else if (name !== '__proto__' || property.computed || property.shorthand || property.method) {
            fields.set(name, property.value);
        }
    }
    return fields;
}

function isPlainAwaitedObject(node) {
    return (
        node.type === 'ObjectExpression' &&
        node.properties.every((property) => {
            if (property.type === 'SpreadElement') {
                return isPlainAwaitedObject(withoutErasedWrappers(property.argument));
            }
            const name = propertyName(property);
            return name !== undefined && name !== 'then' && name !== '__proto__';
        })
    );
}

function awaitMayReject(context, expression) {
    const value = withoutErasedWrappers(expression);
    if (!value || value.type === 'Literal' || isGlobal(context, value, 'undefined') || isPlainAwaitedObject(value)) {
        return false;
    }
    if (isGlobalPromiseCall(context, value, 'resolve')) {
        return awaitMayReject(context, value.arguments[0]);
    }
    return promiseArrayArguments(context, value, 'allSettled') === undefined;
}

function interceptedFailure(context, node, retentionBlock) {
    const canReject =
        node.type === 'ThrowStatement' || (node.type === 'AwaitExpression' && awaitMayReject(context, node.argument));
    if (!canReject) {
        return false;
    }
    const interruption = completionInterruption(context, node, {
        handlerIntercepts: (handler) => !catchEndsByThrowing(handler),
    });
    if (!interruption) {
        return false;
    }
    // An inner catch can resume the statement sequence. Its own abrupt exits are checked separately.
    return (
        interruption.type !== 'CatchClause' ||
        !retentionBlock ||
        interruption.range[0] < retentionBlock.range[0] ||
        interruption.range[1] > retentionBlock.range[1]
    );
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
    const failureSkipsReturn = (node) => interceptedFailure(context, node, statement.parent);
    // A cancellation branch can observe the losing rejection while still rejecting the caller.
    if (ignored !== call && following[0]?.type === 'ThrowStatement') {
        return throwExposesFailure(context, following[0], failureSkipsReturn);
    }
    const variable = variableForIdentifier(context, original);
    const binding = variable?.defs[0];
    if (!binding) {
        return false;
    }
    const owner = enclosingFunction(call);
    const initialization =
        binding.type === 'Parameter' || (binding.type === 'Variable' && ['let', 'const'].includes(binding.parent?.kind))
            ? binding.name
            : undefined;
    const writes = variable.references.filter(
        (reference) => reference.isWrite() && !(reference.init && reference.identifier === initialization)
    );
    const hasCapturedWrite = writes.some((reference) => enclosingFunction(reference.identifier) !== owner);
    const laterWrites = writes.filter((reference) => reference.identifier.range[0] >= call.range[1]);
    const returnsBinding = (value) =>
        isIdentifier(value, original.name) && definitions(context, value)[0]?.node === binding.node;
    function retainsRejectingValue(expression) {
        const value = unwrappedReturnedValue(expression);
        if (returnsBinding(value)) {
            return true;
        }
        if (isGlobalPromiseCall(context, value, 'resolve')) {
            return retainsRejectingValue(value.arguments[0]);
        }
        return safePromiseContinuation(context, value) && retainsRejectingValue(value.callee.object);
    }
    function returnsOriginal(statement) {
        const argument = statement.argument;
        if (
            !argument ||
            hasCapturedWrite ||
            laterWrites.some((reference) => reference.identifier.range[0] < argument.range[1]) ||
            !completionReachesCaller(context, statement) ||
            hasSameFunctionNode(context, argument, (node) => interceptedFailure(context, node))
        ) {
            return false;
        }
        const value = unwrappedReturnedValue(argument);
        if (value?.type === 'ObjectExpression') {
            return [...literalObjectFields(value).values()].some(retainsRejectingValue);
        }
        const joined =
            promiseArrayArguments(context, value, 'all') ?? promiseArrayArguments(context, value, 'allSettled');
        if (joined) {
            return joined.elements.some(retainsRejectingValue);
        }
        return retainsRejectingValue(value);
    }
    return rejectionExits(context, following, { returnsOriginal, failureSkipsReturn }) === 'propagates';
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

function unwrappedReturnedValue(node) {
    let value = unwrap(node);
    while (value?.type === 'TSAsExpression' || value?.type === 'TSTypeAssertion') {
        value = unwrap(value.expression);
    }
    return value;
}

const isTrue = (node) => {
    const value = unwrappedReturnedValue(node);
    return value?.type === 'Literal' && value.value === true;
};

function isSuccessValue(node) {
    const value = unwrappedReturnedValue(node);
    if (value?.type !== 'ObjectExpression') {
        return false;
    }
    const fields = literalObjectFields(value);
    return ['ok', 'success'].some((name) => isTrue(fields.get(name)));
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

function throughErasedParents(expression) {
    let value = expression;
    while (value.parent?.expression === value && ERASED_EXPRESSION_WRAPPERS.has(value.parent.type)) {
        value = value.parent;
    }
    return value;
}

function withoutErasedWrappers(expression) {
    let value = expression;
    while (value && ERASED_EXPRESSION_WRAPPERS.has(value.type)) {
        value = value.expression;
    }
    return value;
}

function isAwaitedThroughErasedWrappers(expression) {
    const value = throughErasedParents(expression);
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

function visibilityOperand(expression) {
    let value = unwrappedReturnedValue(expression);
    let negated = false;
    while (value?.type === 'UnaryExpression' && value.operator === '!') {
        negated = !negated;
        value = unwrappedReturnedValue(value.argument);
    }
    return { value, negated };
}

function visibilityCondition(context, test) {
    let { value: call, negated } = visibilityOperand(test);
    if (call?.type === 'Identifier') {
        const [definition, another] = definitions(context, call);
        if (
            another ||
            definition?.type !== 'Variable' ||
            definition.parent.kind !== 'const' ||
            definition.node.id.type !== 'Identifier'
        ) {
            return undefined;
        }
        const initializer = visibilityOperand(definition.node.init);
        call = initializer.value;
        negated = negated !== initializer.negated;
    }
    if (calledMember(call, 'catch')) {
        call = unwrappedReturnedValue(call.callee.object);
    }
    return calledMember(call, 'isVisible') ? { negated } : undefined;
}

function observesPlaywrightAssertion(context, expression, assertions) {
    const outer = withoutErasedWrappers(expression);
    const value = outer?.type === 'AwaitExpression' ? withoutErasedWrappers(outer.argument) : outer;
    if (
        assertions.some((assertion) => {
            const end = assertionEnd(assertion);
            return end.valid && end.expression === value;
        })
    ) {
        return true;
    }
    const step = value?.type === 'CallExpression' ? value.arguments[1] : undefined;
    if (!isAwaitedPlaywrightStep(context, step)) {
        return false;
    }
    return step.body.type === 'BlockStatement'
        ? !branchCanSkipAssertion(context, step.body, assertions, true)
        : observesPlaywrightAssertion(context, step.body, assertions);
}

function sequenceCanSkipAssertion(context, statements, assertions, nextCanSkip, exitCanSkip) {
    return statements.reduceRight(
        (canSkip, child) => branchCanSkipAssertion(context, child, assertions, canSkip, exitCanSkip),
        nextCanSkip
    );
}

function branchCanSkipAssertion(context, statement, assertions, nextCanSkip, exitCanSkip = () => true) {
    switch (statement?.type) {
        case 'BlockStatement':
            return sequenceCanSkipAssertion(context, statement.body, assertions, nextCanSkip, exitCanSkip);
        case 'IfStatement':
            return (
                branchCanSkipAssertion(context, statement.consequent, assertions, nextCanSkip, exitCanSkip) ||
                branchCanSkipAssertion(context, statement.alternate, assertions, nextCanSkip, exitCanSkip)
            );
        case 'TryStatement': {
            const { block, finalizer, handler } = statement;
            const afterCleanup = branchCanSkipAssertion(context, finalizer, assertions, nextCanSkip, exitCanSkip);
            if (finalizer && finalizerCanReplaceCompletion(context, finalizer, () => true)) {
                return afterCleanup;
            }
            return (
                branchCanSkipAssertion(context, block, assertions, afterCleanup, exitCanSkip) ||
                (handler ? branchCanSkipAssertion(context, handler.body, assertions, afterCleanup, exitCanSkip) : false)
            );
        }
        case 'ThrowStatement':
            return !completionReachesCaller(context, statement);
        case 'ReturnStatement':
            return exitCanSkip(statement) && !observesPlaywrightAssertion(context, statement.argument, assertions);
        case 'BreakStatement':
        case 'ContinueStatement':
            return exitCanSkip(statement);
        case 'ExpressionStatement':
            return nextCanSkip && !observesPlaywrightAssertion(context, statement.expression, assertions);
        default:
            return nextCanSkip;
    }
}

function missingBranchCanSkipAssertion(context, statement, absent, { callback, assertions }) {
    const route = [];
    for (let current = statement; current !== callback; current = current.parent) {
        route.push(current);
    }
    const after = new Map([[callback, true]]);
    const exitCanSkip = (exit) => {
        const target = exit.type === 'ReturnStatement' ? enclosingFunction(exit) : jumpTarget(exit);
        return after.get(target) ?? true;
    };
    let nextCanSkip = true;
    for (const current of route.reverse()) {
        const parent = current.parent;
        if (parent.type === 'ReturnStatement') {
            nextCanSkip = exitCanSkip(parent);
        }
        const siblings = parent.type === 'BlockStatement' ? parent.body : parent.consequent;
        const index = Array.isArray(siblings) ? siblings.indexOf(current) : -1;
        if (index >= 0) {
            if (!sequenceCanSkipAssertion(context, siblings.slice(0, index), assertions, true, exitCanSkip)) {
                return false;
            }
            nextCanSkip = sequenceCanSkipAssertion(
                context,
                siblings.slice(index + 1),
                assertions,
                nextCanSkip,
                exitCanSkip
            );
        }
        // A jump out of this statement resumes after its siblings have been accounted for.
        after.set(current, nextCanSkip);
    }
    return branchCanSkipAssertion(context, absent, assertions, nextCanSkip, exitCanSkip);
}

function assertionGuard(context, { statement, negated }, test) {
    const { assertions } = test;
    const laterAssertion = assertions.some((node) => node.range[0] >= statement.range[1]);
    const present = negated ? statement.alternate : statement.consequent;
    const presentAssertion =
        present && assertions.some((node) => node.range[0] >= present.range[0] && node.range[1] <= present.range[1]);
    if (!laterAssertion && !presentAssertion) {
        return false;
    }
    const absent = negated ? statement.consequent : statement.alternate;
    return missingBranchCanSkipAssertion(context, statement, absent, test);
}

const noConditionalPlaywrightAdmission = rule(
    'Require Playwright assertions to be reachable when a required locator is absent.',
    (context) => {
        const testsByCallback = new Map();

        function owningTest(node) {
            let owner = enclosingFunction(node);
            while (isAwaitedPlaywrightStep(context, owner)) {
                owner = enclosingFunction(owner);
            }
            return testsByCallback.get(owner);
        }

        return {
            CallExpression(node) {
                const callback = playwrightTestCallback(context, node);
                if (callback) {
                    testsByCallback.set(callback, { callback, assertions: [], guards: [] });
                    return;
                }
                if (
                    playwrightBinding(context, node.callee, 'expect') ||
                    (['poll', 'soft'].includes(memberName(node.callee)) &&
                        playwrightBinding(context, node.callee.object, 'expect'))
                ) {
                    owningTest(node)?.assertions.push(node);
                }
            },
            IfStatement(node) {
                const test = owningTest(node);
                if (!test) {
                    return;
                }
                const condition = visibilityCondition(context, node.test);
                if (condition) {
                    test.guards.push({ statement: node, negated: condition.negated });
                }
            },
            'Program:exit'() {
                for (const test of testsByCallback.values()) {
                    if (test.assertions.length === 0) {
                        continue;
                    }
                    const guard = test.guards.find((guard) => assertionGuard(context, guard, test));
                    if (guard) {
                        context.report({
                            node: guard.statement,
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
    const values = withoutErasedWrappers(call.arguments[0]);
    return values?.type === 'ArrayExpression' ? values : undefined;
}

function observationExpression(context, assertion) {
    let current = throughErasedParents(assertion);
    while (current.parent) {
        const parent = current.parent;
        if (parent.type === 'ArrayExpression') {
            const array = throughErasedParents(parent);
            if (promiseArrayArguments(context, array.parent, 'all') === parent) {
                current = throughErasedParents(array.parent);
                continue;
            }
        }
        if (parent.type === 'MemberExpression' && parent.object === current && parent.parent?.callee === parent) {
            const continuation = parent.parent;
            if (safePromiseContinuation(context, continuation)) {
                current = throughErasedParents(continuation);
                continue;
            }
        }
        break;
    }
    return current;
}

function bindingConsumption(context, expression, declaration) {
    const value = withoutErasedWrappers(expression);
    if (value?.type === 'AwaitExpression') {
        const consumption = bindingConsumption(context, value.argument, declaration);
        return consumption?.type === 'Identifier' ? value : consumption;
    }
    if (value?.type === 'ChainExpression') {
        return bindingConsumption(context, value.expression, declaration);
    }
    if (isIdentifier(value, declaration.id.name)) {
        return definitions(context, value)[0]?.node === declaration ? value : undefined;
    }
    const array = promiseArrayArguments(context, value, 'all');
    if (array) {
        let read;
        for (const element of array.elements) {
            const consumption = bindingConsumption(context, element, declaration);
            if (consumption?.type === 'AwaitExpression') {
                return consumption;
            }
            read ??= consumption;
        }
        return read;
    }
    if (safePromiseContinuation(context, value)) {
        return bindingConsumption(context, value.callee.object, declaration);
    }
    return undefined;
}

export function hasSameFunctionNode(context, node, predicate) {
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

function catchEndsByThrowing(handler) {
    const statements = handler.body.body;
    return (
        statements.at(-1)?.type === 'ThrowStatement' &&
        statements.slice(0, -1).every(({ type }) => type === 'ExpressionStatement' || type === 'VariableDeclaration')
    );
}

function assertionCompletionReachesCaller(context, statement) {
    const catchesFailure = statement.type === 'AwaitExpression' || statement.type === 'ThrowStatement';
    return completionReachesCaller(context, statement, {
        handlerIntercepts: (handler) => catchesFailure && !catchEndsByThrowing(handler),
        replacesThrow: (throwStatement) => !assertionCompletionReachesCaller(context, throwStatement),
    });
}

function maySkipObservation(context, node, declaration) {
    return hasSameFunctionNode(context, node, (current) => {
        if (['ReturnStatement', 'BreakStatement', 'ContinueStatement'].includes(current.type)) {
            return true;
        }
        return (
            current.type === 'AwaitExpression' &&
            bindingConsumption(context, current, declaration) !== undefined &&
            !assertionCompletionReachesCaller(context, current)
        );
    });
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
        if (following.type === 'ExpressionStatement') {
            const expression = withoutErasedWrappers(following.expression);
            if (expression?.type === 'AwaitExpression') {
                const consumption = bindingConsumption(context, expression, declaration);
                if (consumption) {
                    return assertionCompletionReachesCaller(context, consumption);
                }
            }
        }
        if (following.type === 'ReturnStatement') {
            const consumption = bindingConsumption(context, following.argument, declaration);
            return (
                consumption !== undefined &&
                assertionCompletionReachesCaller(
                    context,
                    consumption.type === 'AwaitExpression' ? consumption : following
                )
            );
        }
        if (maySkipObservation(context, following, declaration)) {
            return false;
        }
    }
    return false;
}

function assertionObserved(context, expression) {
    const assertion = observationExpression(context, expression);
    const parent = assertion.parent;
    if ((parent?.type === 'AwaitExpression' || parent?.type === 'ReturnStatement') && parent.argument === assertion) {
        return assertionCompletionReachesCaller(context, parent);
    }
    return (
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

function isPositionalBoolean(parameter) {
    const positional = parameter.type === 'TSParameterProperty' ? parameter.parameter : parameter;
    const hasDefault = positional.type === 'AssignmentPattern';
    const binding = hasDefault ? positional.left : positional;
    if (binding.type !== 'Identifier') {
        return false;
    }
    if (binding.typeAnnotation) {
        return binding.typeAnnotation.typeAnnotation.type === 'TSBooleanKeyword';
    }
    return hasDefault && positional.right.type === 'Literal' && typeof positional.right.value === 'boolean';
}

function hasCallerParameterShape(context, node) {
    const expression = throughErasedParents(node);
    const parent = expression.parent;
    if (parent?.type === 'CallExpression' || parent?.type === 'NewExpression') {
        return parent.arguments.includes(expression);
    }
    const annotation = parent?.type === 'VariableDeclarator' && parent.id.typeAnnotation?.typeAnnotation;
    return (
        annotation?.type === 'TSTypeReference' &&
        definitions(context, annotation.typeName).some((definition) => definition.type === 'ImportBinding')
    );
}

const noPositionalBooleanFlags = rule('Name multiple boolean flags in an options object.', (context) => {
    function inspect(node) {
        const flags = node.params.filter(isPositionalBoolean);
        if (flags.length >= 2 && !hasCallerParameterShape(context, node)) {
            context.report({
                node: flags[1],
                message: 'Multiple positional boolean flags hide their meaning. Name them in an options object.',
            });
        }
    }

    return { FunctionDeclaration: inspect, FunctionExpression: inspect, ArrowFunctionExpression: inspect };
});

export const qualityRules = {
    'no-conditional-playwright-admission': noConditionalPlaywrightAdmission,
    'no-external-data-assertion': noExternalDataAssertion,
    'no-failed-operation-success': noFailedOperationSuccess,
    'no-fixed-test-sleep': noFixedTestSleep,
    'no-invalid-vitest-expect': noInvalidVitestExpect,
    'no-positional-boolean-flags': noPositionalBooleanFlags,
    'no-silent-catch': noSilentCatch,
};
