module.exports = function(fileInfo, api) {
    const j = api.jscodeshift;
    const root = j(fileInfo.source);

    let hasModifications = false;

    // Helper to recursively unwrap a ConditionalExpression into an array of if-statements
    function createIfStatements(expr) {
        if (expr.type === 'ConditionalExpression') {
            return [
                j.ifStatement(
                    expr.test,
                    j.blockStatement([j.returnStatement(expr.consequent)]),
                    j.blockStatement(createIfStatements(expr.alternate))
                )
            ];
        }
        return [j.returnStatement(expr)];
    }

    // Find all ConditionalExpressions that have another ConditionalExpression inside their consequent or alternate
    root.find(j.ConditionalExpression).forEach(path => {
        // Only process the outermost ConditionalExpression
        let isOutermost = true;
        let parent = path.parent;
        while (parent && parent.node) {
            if (parent.node.type === 'ConditionalExpression') {
                isOutermost = false;
                break;
            }
            parent = parent.parent;
        }

        if (!isOutermost) return;

        // Check if it actually contains a nested ConditionalExpression
        const hasNested = j(path).find(j.ConditionalExpression).size() > 1;
        if (!hasNested) return;

        // Convert the nested ternary to an IIFE with if statements
        const ifStatements = createIfStatements(path.node);
        const iife = j.callExpression(
            j.arrowFunctionExpression(
                [],
                j.blockStatement(ifStatements)
            ),
            []
        );

        // If it's a JSXExpressionContainer child, we might need to wrap it carefully,
        // but replacing the ConditionalExpression itself with an IIFE works in JSX as well.
        path.replace(iife);
        hasModifications = true;
    });

    return hasModifications ? root.toSource() : null;
};
