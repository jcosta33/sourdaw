import { FileInfo, API, Options } from 'jscodeshift';
import * as fs from 'fs';
import * as path from 'path';

// Helper to recursively find all TypeScript files in a directory
function getAllTsFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      if (!filePath.includes('node_modules') && !filePath.includes('.git') && !filePath.includes('dist')) {
        results = results.concat(getAllTsFiles(filePath));
      }
    } else if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      results.push(filePath);
    }
  });
  return results;
}

export default function transform(fileInfo: FileInfo, api: API, options: Options) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  // 1. Find all named and default exports
  const namedExports = root.find(j.ExportNamedDeclaration);
  const defaultExports = root.find(j.ExportDefaultDeclaration);
  const allExportNodes = [...namedExports.nodes(), ...defaultExports.nodes()];
  
  if (allExportNodes.length <= 1) {
    return null; // Skip files with 1 or 0 exports
  }

  // 2. Extract all top-level statements
  const imports = root.find(j.ImportDeclaration).nodes();
  const program = root.find(j.Program).get();
  const topLevelNodes = program.node.body;
  
  const localDeclarations = topLevelNodes.filter((node: any) => 
    node.type !== 'ExportNamedDeclaration' && 
    node.type !== 'ExportDefaultDeclaration' && 
    node.type !== 'ImportDeclaration'
  );

  const getIdentifiers = (node: any) => {
    const names = new Set<string>();
    j(node).find(j.Identifier).forEach(p => {
      names.add(p.node.name);
    });
    return names;
  };

  // 3. Map local declarations to defined names and required references
  const localDeclsMeta = localDeclarations.map((decl: any) => {
    const names: string[] = [];
    if (
      decl.type === 'FunctionDeclaration' || 
      decl.type === 'ClassDeclaration' || 
      decl.type === 'TSTypeAliasDeclaration' || 
      decl.type === 'TSInterfaceDeclaration' ||
      decl.type === 'TSEnumDeclaration'
    ) {
      if (decl.id && decl.id.type === 'Identifier') {
        names.push(decl.id.name);
      }
    } else if (decl.type === 'VariableDeclaration') {
      decl.declarations.forEach((d: any) => {
        if (d.type === 'VariableDeclarator' && d.id && d.id.type === 'Identifier') {
          names.push(d.id.name);
        }
      });
    }
    
    const refs = getIdentifiers(decl);
    // Don't count the defined names as dependencies of themselves
    names.forEach(n => refs.delete(n));
    return { decl, names, refs };
  });

  const getExportName = (node: any, index: number) => {
    if (node.type === 'ExportDefaultDeclaration') {
      if (node.declaration.id && node.declaration.id.name) {
        return node.declaration.id.name;
      }
      return 'index';
    }
    if (node.declaration) {
      if (node.declaration.type === 'FunctionDeclaration' || node.declaration.type === 'ClassDeclaration') {
        return node.declaration.id?.name;
      }
      if (node.declaration.type === 'VariableDeclaration') {
        return node.declaration.declarations[0]?.id?.name;
      }
      if (node.declaration.type === 'TSTypeAliasDeclaration' || node.declaration.type === 'TSInterfaceDeclaration' || node.declaration.type === 'TSEnumDeclaration') {
        return node.declaration.id?.name;
      }
    }
    if (node.specifiers && node.specifiers.length > 0) {
      return node.specifiers[0].exported.name;
    }
    return `useCase_${index}`;
  };

  // Map original exported names to the new file names they will reside in
  const exportNamesMap = new Map<string, string>();
  let defaultExportName: string | null = null;

  allExportNodes.forEach((exp, index) => {
    const expFileName = getExportName(exp, index) || `useCase_${index}`;
    if (exp.type === 'ExportNamedDeclaration') {
      if (exp.declaration) {
        if (exp.declaration.type === 'VariableDeclaration') {
          exp.declaration.declarations.forEach((d: any) => {
            if (d.id && d.id.type === 'Identifier') {
              exportNamesMap.set(d.id.name, expFileName);
            }
          });
        } else if (exp.declaration.id && exp.declaration.id.type === 'Identifier') {
          exportNamesMap.set(exp.declaration.id.name, expFileName);
        }
      }
      if (exp.specifiers) {
        exp.specifiers.forEach((spec: any) => {
          if (spec.exported && spec.exported.type === 'Identifier') {
            exportNamesMap.set(spec.exported.name, expFileName);
          }
        });
      }
    } else if (exp.type === 'ExportDefaultDeclaration') {
      defaultExportName = expFileName;
    }
  });

  // 4. Build a dependency map from each export to local declarations it requires
  const exportDeps = new Map<any, Set<any>>();
  allExportNodes.forEach(exp => {
    const deps = new Set<any>();
    const currentRefs = getIdentifiers(exp);
    let changed = true;
    while (changed) {
      changed = false;
      for (const meta of localDeclsMeta) {
        if (!deps.has(meta.decl)) {
          const isNeeded = meta.names.some(name => currentRefs.has(name));
          if (isNeeded) {
            deps.add(meta.decl);
            meta.refs.forEach(r => currentRefs.add(r));
            changed = true;
          }
        }
      }
    }
    exportDeps.set(exp, deps);
  });

  // 5. Categorize local declarations into shared vs exclusive
  const sharedLocals = new Set<any>();
  const exclusiveLocals = new Map<any, any>(); // maps local decl -> owning export node

  for (const meta of localDeclsMeta) {
    const usingExports = [];
    allExportNodes.forEach(exp => {
      if (exportDeps.get(exp)?.has(meta.decl)) {
        usingExports.push(exp);
      }
    });

    if (usingExports.length > 1) {
      sharedLocals.add(meta.decl);
    } else if (usingExports.length === 1) {
      exclusiveLocals.set(meta.decl, usingExports[0]);
    } else {
      // If unused or dead code, keep it in shared to prevent loss
      sharedLocals.add(meta.decl);
    }
  }

  // 6. Set up new directory and files
  const filePath = fileInfo.path;
  const dirName = path.dirname(filePath);
  const extName = path.extname(filePath);
  const baseName = path.basename(filePath, extName);
  
  const newDirPath = path.join(dirName, baseName);
  const isDryRun = options.dry || options.d;

  if (!isDryRun && !fs.existsSync(newDirPath)) {
    fs.mkdirSync(newDirPath, { recursive: true });
  }

  const getRequiredImports = (nodes: any[], activeRefs: Set<string>) => {
    const reqImports: any[] = [];
    imports.forEach((imp: any) => {
      if (!imp.specifiers || imp.specifiers.length === 0) {
        reqImports.push(imp);
        return;
      }
      const neededSpecifiers = imp.specifiers.filter((spec: any) => {
        if (spec.local && spec.local.type === 'Identifier') {
          return activeRefs.has(spec.local.name);
        }
        return false;
      });
      if (neededSpecifiers.length > 0) {
        reqImports.push(j.importDeclaration(neededSpecifiers, imp.source));
      }
    });
    return reqImports;
  };

  const sharedNames = new Set<string>();
  
  // 7. Generate helpers.ts (if shared locals exist)
  if (sharedLocals.size > 0) {
    const refs = new Set<string>();
    sharedLocals.forEach(decl => {
      const meta = localDeclsMeta.find(m => m.decl === decl);
      if (meta) {
        meta.names.forEach(n => sharedNames.add(n));
        meta.refs.forEach(r => refs.add(r));
      }
    });

    const reqImports = getRequiredImports(Array.from(sharedLocals), refs);
    
    // Convert local declarations to exported declarations so they can be consumed
    const sharedFileNodes = [
      ...reqImports,
      ...Array.from(sharedLocals).map((decl: any) => j.exportNamedDeclaration(decl))
    ];
    
    const sharedAst = j.program(sharedFileNodes);
    const sharedSource = j(sharedAst).toSource({ quote: 'single', trailingComma: true });
    const sharedFilePath = path.join(newDirPath, `helpers${extName}`);
    
    if (!isDryRun) {
      fs.writeFileSync(sharedFilePath, sharedSource, 'utf-8');
    } else {
      console.log(`\n[Dry Run] Would create: ${sharedFilePath}\n`);
    }
  }

  // 8. Generate individual use-case files
  allExportNodes.forEach((exp, index) => {
    const expName = getExportName(exp, index) || `useCase_${index}`;
    
    const myLocals: any[] = [];
    exclusiveLocals.forEach((ownerExp, decl) => {
      if (ownerExp === exp) myLocals.push(decl);
    });

    const refs = new Set<string>();
    getIdentifiers(exp).forEach(r => refs.add(r));
    myLocals.forEach(decl => {
      const meta = localDeclsMeta.find(m => m.decl === decl);
      if (meta) meta.refs.forEach(r => refs.add(r));
    });

    const reqImports = getRequiredImports([...myLocals, exp], refs);

    // Add import to shared helpers if this use case depends on them
    const neededShared = Array.from(sharedNames).filter(name => refs.has(name));
    if (neededShared.length > 0) {
      const specifiers = neededShared.map(name => j.importSpecifier(j.identifier(name)));
      reqImports.push(j.importDeclaration(specifiers, j.literal('./helpers')));
    }

    const newAstNodes = [
      ...reqImports,
      ...myLocals,
      exp
    ];

    const newAst = j.program(newAstNodes);
    const newSource = j(newAst).toSource({ quote: 'single', trailingComma: true });
    const newFilePath = path.join(newDirPath, `${expName}${extName}`);
    
    if (!isDryRun) {
      fs.writeFileSync(newFilePath, newSource, 'utf-8');
    } else {
      console.log(`\n[Dry Run] Would create: ${newFilePath}\n`);
    }
  });

  // 9. Delete original file
  if (!isDryRun) {
    fs.unlinkSync(filePath);
  } else {
    console.log(`\n[Dry Run] Would delete original file: ${filePath}\n`);
  }

  // 10. Scan entire project and update files importing the split file
  const srcDir = path.resolve(process.cwd(), 'src');
  const allFiles = getAllTsFiles(srcDir);
  
  allFiles.forEach(importerPath => {
    if (importerPath === filePath) return; // Skip original file

    let content = fs.readFileSync(importerPath, 'utf-8');
    // Fast path: if it doesn't even contain the basename, it's not importing it
    if (!content.includes(baseName)) return;

    const rootAst = j(content);
    let changed = false;

    rootAst.find(j.ImportDeclaration).forEach(pathPath => {
      const source = pathPath.node.source.value;
      if (typeof source !== 'string') return;

      let resolvedSource = '';
      if (source.startsWith('#/')) {
        // Resolve path alias configured in tsconfig.json
        resolvedSource = path.resolve(process.cwd(), 'src', source.slice(2));
      } else {
        // Resolve relative path
        const importerDir = path.dirname(importerPath);
        resolvedSource = path.resolve(importerDir, source);
      }
      
      const fileWithoutExt = filePath.replace(/\.[^.]+$/, '');

      if (resolvedSource === fileWithoutExt || resolvedSource === filePath) {
        const newImports: any[] = [];
        
        pathPath.node.specifiers?.forEach((spec: any) => {
          if (spec.type === 'ImportSpecifier') {
            const importedName = spec.imported.name;
            const expOwnerName = exportNamesMap.get(importedName);
            if (expOwnerName) {
              newImports.push(
                j.importDeclaration(
                  [spec],
                  j.literal(`${source}/${expOwnerName}`)
                )
              );
            }
          } else if (spec.type === 'ImportDefaultSpecifier') {
            if (defaultExportName) {
              newImports.push(
                j.importDeclaration(
                  [spec],
                  j.literal(`${source}/${defaultExportName}`)
                )
              );
            }
          }
        });

        if (newImports.length > 0) {
          j(pathPath).replaceWith(newImports);
          changed = true;
        }
      }
    });

    if (changed) {
      if (!isDryRun) {
        fs.writeFileSync(importerPath, rootAst.toSource({ quote: 'single', trailingComma: true }), 'utf-8');
      } else {
        console.log(`\n[Dry Run] Would update imports in: ${importerPath}\n`);
      }
    }
  });

  return null;
}

export const parser = 'tsx';
