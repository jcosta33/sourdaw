import { Project, SyntaxKind, Node } from 'ts-morph';
import fs from 'fs';
import path from 'path';

const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
});

const filesToProcess = [
    'src/modules/Fermenter/presentations/components/WarpSection.tsx',
    'src/modules/Workspace/presentations/components/LaunchScreen.tsx',
    'src/modules/Workspace/presentations/components/NotificationToast.tsx',
    'src/modules/Workspace/presentations/views/AppShell.tsx',
    'src/modules/Workspace/presentations/views/AutomationBottomPanel.tsx',
    'src/modules/Workspace/presentations/views/AutomationView/AutomationLaneRow.tsx',
    'src/modules/Workspace/presentations/views/ClipView.tsx',
    'src/modules/Workspace/presentations/views/ClipView/KneadEditor.tsx',
    'src/modules/Workspace/presentations/views/ClipView/PianoRollToolbar.tsx',
    'src/modules/Workspace/presentations/views/Inspector/ClipMidiAiSection.tsx',
    'src/modules/Workspace/presentations/views/Inspector/DeviceInspector.tsx',
    'src/modules/Workspace/presentations/views/Inspector/TrackHeaderSection.tsx',
    'src/modules/Workspace/presentations/views/Inspector/TrackLevelSection.tsx',
    'src/modules/Workspace/presentations/views/Inspector/layouts/ChorusLayout.tsx',
    'src/modules/Workspace/presentations/views/InspectorPanel.tsx',
];

let iifeCounter = 0;

for (const filePath of filesToProcess) {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
        console.warn(`File not found: ${filePath}`);
        continue;
    }

    const sourceFile = project.addSourceFileAtPath(absolutePath);
    let changed = false;

    let keepProcessing = true;
    while (keepProcessing) {
        keepProcessing = false;

        const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
        for (const callExpr of callExpressions) {
            let expression = callExpr.getExpression();
            if (Node.isParenthesizedExpression(expression)) {
                expression = expression.getExpression();
            }

            if (!Node.isArrowFunction(expression) && !Node.isFunctionExpression(expression)) {
                continue;
            }

            let parent = callExpr.getParent();
            let isInsideJsx = false;
            while (parent && !Node.isStatement(parent) && !Node.isBlock(parent)) {
                if (Node.isJsxExpression(parent) || Node.isJsxElement(parent) || Node.isJsxSelfClosingElement(parent)) {
                    isInsideJsx = true;
                    break;
                }
                parent = parent.getParent();
            }

            if (!isInsideJsx) {
                continue;
            }

            let current: Node = callExpr;
            let insertBeforeNode: Node | null = null;
            let containerBlock: Node | null = null;

            while (current) {
                const p = current.getParent();
                if (!p) break;

                if (Node.isBlock(p) || Node.isSourceFile(p)) {
                    insertBeforeNode = current;
                    containerBlock = p;
                    break;
                }

                if (Node.isArrowFunction(p) && p.getBody() === current && !Node.isBlock(current)) {
                    const isAsync = p.isAsync() ? 'async ' : '';
                    let typeParamsStr = '';
                    if (p.getTypeParameters().length > 0) {
                        if (p.getTypeParameters().length === 1) {
                            typeParamsStr = `<${p.getTypeParameters()[0]!.getText()},>`;
                        } else {
                            typeParamsStr = `<${p
                                .getTypeParameters()
                                .map((tp) => tp.getText())
                                .join(', ')}>`;
                        }
                    }

                    const paramsStr = p
                        .getParameters()
                        .map((param) => param.getText())
                        .join(', ');
                    const returnTypeStr = p.getReturnTypeNode() ? `: ${p.getReturnTypeNode()!.getText()}` : '';

                    p.replaceWithText(
                        `${isAsync}${typeParamsStr}(${paramsStr})${returnTypeStr} => {\nreturn ${current.getText()};\n}`
                    );
                    keepProcessing = true;
                    break;
                }

                current = p;
            }

            if (keepProcessing) break;

            if (insertBeforeNode && containerBlock && Node.isStatement(insertBeforeNode)) {
                iifeCounter++;
                const funcName = `renderIife_${iifeCounter}`;
                const funcText = expression.getText();

                if (Node.isBlock(containerBlock) || Node.isSourceFile(containerBlock)) {
                    const index = insertBeforeNode.getChildIndex();
                    (containerBlock as any).insertVariableStatement(index, {
                        declarationKind: 'const',
                        declarations: [
                            {
                                name: funcName,
                                initializer: funcText,
                            },
                        ],
                    });
                }

                callExpr.replaceWithText(`${funcName}()`);
                changed = true;
                keepProcessing = true;
                break;
            }
        }
    }

    if (changed) {
        sourceFile.saveSync();
        console.log(`Updated ${filePath}`);
    } else {
        console.log(`No IIFEs found in ${filePath}`);
    }
}

console.log('Done!');
