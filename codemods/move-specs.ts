import { FileInfo, API, Options } from 'jscodeshift';
import * as fs from 'fs';
import * as path from 'path';

export default function transform(fileInfo: FileInfo, api: API, options: Options) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  const filePath = fileInfo.path;
  
  // Only process .spec.ts files
  if (!filePath.endsWith('.spec.ts') && !filePath.endsWith('.spec.tsx')) {
    return null;
  }
  
  // Skip if already inside a __tests__ directory
  if (filePath.includes('/__tests__/') || filePath.includes('\\__tests__\\')) {
    return null;
  }

  const oldDir = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const newDir = path.join(oldDir, '__tests__');
  const newFilePath = path.join(newDir, fileName);

  // Prevent data loss by checking if target already exists
  if (fs.existsSync(newFilePath) && !options.dry && !options.d) {
    console.error(`[Error] Target file already exists: ${newFilePath}. Skipping ${filePath} to prevent data loss.`);
    return null;
  }

  const isDryRun = options.dry || options.d;

  let hasModifications = false;

  // Update relative imports
  root.find(j.ImportDeclaration).forEach(pathNode => {
    const source = pathNode.node.source.value;
    if (typeof source === 'string' && source.startsWith('.')) {
      // Resolve the absolute path of the imported module based on the old directory
      const absoluteImportPath = path.resolve(oldDir, source);
      
      // Calculate the new relative path from the new directory
      let newRelativePath = path.relative(newDir, absoluteImportPath);
      
      // path.relative might return 'someModule', we need to ensure it starts with './' or '../'
      if (!newRelativePath.startsWith('.')) {
        newRelativePath = './' + newRelativePath;
      }
      
      // To match standard unix paths
      newRelativePath = newRelativePath.replace(/\\/g, '/');

      pathNode.node.source.value = newRelativePath;
      hasModifications = true;
    }
  });

  // Update relative exports
  root.find(j.ExportNamedDeclaration).forEach(pathNode => {
    if (pathNode.node.source && typeof pathNode.node.source.value === 'string' && pathNode.node.source.value.startsWith('.')) {
      const absoluteImportPath = path.resolve(oldDir, pathNode.node.source.value);
      let newRelativePath = path.relative(newDir, absoluteImportPath);
      if (!newRelativePath.startsWith('.')) {
        newRelativePath = './' + newRelativePath;
      }
      newRelativePath = newRelativePath.replace(/\\/g, '/');
      pathNode.node.source.value = newRelativePath;
      hasModifications = true;
    }
  });

  root.find(j.ExportAllDeclaration).forEach(pathNode => {
    if (pathNode.node.source && typeof pathNode.node.source.value === 'string' && pathNode.node.source.value.startsWith('.')) {
      const absoluteImportPath = path.resolve(oldDir, pathNode.node.source.value);
      let newRelativePath = path.relative(newDir, absoluteImportPath);
      if (!newRelativePath.startsWith('.')) {
        newRelativePath = './' + newRelativePath;
      }
      newRelativePath = newRelativePath.replace(/\\/g, '/');
      pathNode.node.source.value = newRelativePath;
      hasModifications = true;
    }
  });

  // We also need to check for dynamic imports: import('./foo')
  root.find(j.CallExpression, { callee: { type: 'Import' } }).forEach(pathNode => {
    const arg = pathNode.node.arguments[0];
    if (arg && (arg.type === 'Literal' || arg.type === 'StringLiteral') && typeof arg.value === 'string' && arg.value.startsWith('.')) {
      const absoluteImportPath = path.resolve(oldDir, arg.value);
      let newRelativePath = path.relative(newDir, absoluteImportPath);
      if (!newRelativePath.startsWith('.')) {
        newRelativePath = './' + newRelativePath;
      }
      newRelativePath = newRelativePath.replace(/\\/g, '/');
      arg.value = newRelativePath;
      hasModifications = true;
    }
  });

  // We also need to check for jest/vitest vi.* and jest.* methods that take module paths
  root.find(j.CallExpression, { callee: { type: 'MemberExpression' } }).forEach(pathNode => {
    const callee = pathNode.node.callee;
    if (
      callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' &&
      (callee.object.name === 'vi' || callee.object.name === 'jest') &&
      callee.property.type === 'Identifier' &&
      ['mock', 'unmock', 'doMock', 'importActual', 'importMock'].includes(callee.property.name)
    ) {
      const arg = pathNode.node.arguments[0];
      if (arg && (arg.type === 'Literal' || arg.type === 'StringLiteral') && typeof arg.value === 'string' && arg.value.startsWith('.')) {
        const absoluteImportPath = path.resolve(oldDir, arg.value);
        let newRelativePath = path.relative(newDir, absoluteImportPath);
        if (!newRelativePath.startsWith('.')) {
          newRelativePath = './' + newRelativePath;
        }
        newRelativePath = newRelativePath.replace(/\\/g, '/');
        arg.value = newRelativePath;
        hasModifications = true;
      }
    }
  });

  const newSource = root.toSource({ quote: 'single', trailingComma: true });

  if (!isDryRun) {
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir, { recursive: true });
    }
    fs.writeFileSync(newFilePath, newSource, 'utf-8');
    fs.unlinkSync(filePath);
  } else {
    console.log(`\n[Dry Run] Would move:\n  From: ${filePath}\n  To:   ${newFilePath}`);
    if (hasModifications) {
      console.log(`  Imports updated. New source preview:\n`);
      console.log(newSource);
    }
  }

  // Return null so jscodeshift doesn't try to overwrite the original file we just deleted
  return null;
}

export const parser = 'tsx';
