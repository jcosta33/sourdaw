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
  
  // Skip if already inside a _tests directory
  if (filePath.includes('/_tests/') || filePath.includes('\\_tests\\')) {
    return null;
  }

  const oldDir = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const newDir = path.join(oldDir, '_tests');
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

  // We also need to check for dynamic imports: import('./foo')
  root.find(j.CallExpression, { callee: { type: 'Import' } }).forEach(pathNode => {
    const arg = pathNode.node.arguments[0];
    if (arg && arg.type === 'Literal' && typeof arg.value === 'string' && arg.value.startsWith('.')) {
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

  // We also need to check for jest/vitest vi.mock('./foo')
  root.find(j.CallExpression, { callee: { type: 'MemberExpression', object: { name: 'vi' }, property: { name: 'mock' } } }).forEach(pathNode => {
    const arg = pathNode.node.arguments[0];
    if (arg && arg.type === 'Literal' && typeof arg.value === 'string' && arg.value.startsWith('.')) {
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
