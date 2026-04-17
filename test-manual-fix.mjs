import { Project, SyntaxKind } from 'ts-morph';
import * as path from 'path';

const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
});

project.addSourceFilesAtPaths('src/modules/Transport/useCases/transportControls/__tests__/setPreRollBars.spec.ts');

const sourceFile = project.getSourceFiles()[0];

sourceFile.addImportDeclaration({
    moduleSpecifier: '#/modules/Transport/repositories/transport/getTransportState',
    namedImports: ['getTransportState'],
});
sourceFile.addImportDeclaration({
    moduleSpecifier: '#/modules/Transport/repositories/transport/updateTransportState',
    namedImports: ['updateTransportState'],
});
sourceFile.insertStatements(sourceFile.getImportDeclarations().length, [
    `vi.mock('#/modules/Transport/repositories/transport/getTransportState');`,
    `vi.mock('#/modules/Transport/repositories/transport/updateTransportState');`,
]);

sourceFile.saveSync();
console.log('Done!');
