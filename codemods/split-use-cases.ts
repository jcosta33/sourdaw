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

interface NodeMeta {
  astNode: any;
  isExported: boolean;
  definedNames: string[];
  referencedNames: Set<string>;
  dependencies: Set<NodeMeta>;
}

export default function transform(fileInfo: FileInfo, api: API, options: Options) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  const imports = root.find(j.ImportDeclaration).nodes();
  const program = root.find(j.Program).get();
  const topLevelNodes = program.node.body;

  const nodesMeta: NodeMeta[] = [];

  const extractDefinedNames = (decl: any) => {
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
        if (d.type === 'VariableDeclarator') {
           j(d.id).find(j.Identifier).forEach(p => names.push(p.node.name));
        }
      });
    }
    return names;
  };

  topLevelNodes.forEach((node: any) => {
    if (node.type === 'ImportDeclaration') return;
    
    const meta: NodeMeta = {
      astNode: node,
      isExported: false,
      definedNames: [],
      referencedNames: new Set(),
      dependencies: new Set()
    };

    if (node.type === 'ExportNamedDeclaration') {
      meta.isExported = true;
      if (node.declaration) {
        meta.definedNames = extractDefinedNames(node.declaration);
      } else if (node.specifiers) {
        // export { x as y }; doesn't define a new local variable, it references x.
        // We capture references generically below.
      }
    } else if (node.type === 'ExportDefaultDeclaration') {
      meta.isExported = true;
      if (node.declaration) {
        if (node.declaration.id && node.declaration.id.type === 'Identifier') {
          meta.definedNames.push(node.declaration.id.name);
        } else if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
          meta.definedNames.push(node.declaration.id.name);
        } else if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
          meta.definedNames.push(node.declaration.id.name);
        }
      }
    } else {
      meta.definedNames = extractDefinedNames(node);
    }

    // Generic reference extraction
    j(node).find(j.Identifier).forEach(p => {
      // Exclude property keys in object literals from being considered as references
      const parent = p.parentPath.node;
      if (parent.type === 'Property' && parent.key === p.node && !parent.computed) {
         return; 
      }
      if (parent.type === 'MemberExpression' && parent.property === p.node && !parent.computed) {
         return;
      }
      meta.referencedNames.add(p.node.name);
    });
    
    // A node doesn't depend on itself
    meta.definedNames.forEach(n => meta.referencedNames.delete(n));

    nodesMeta.push(meta);
  });

  // Build dependency graph
  nodesMeta.forEach(node => {
    node.referencedNames.forEach(refName => {
      const provider = nodesMeta.find(n => n !== node && n.definedNames.includes(refName));
      if (provider) {
        node.dependencies.add(provider);
      }
    });
  });

  const isReferencedByAnotherNode = (targetNode: NodeMeta) => {
    return nodesMeta.some(n => n !== targetNode && n.dependencies.has(targetNode));
  };

  // Roots are exported nodes that nothing else in the file depends on.
  const roots = nodesMeta.filter(n => n.isExported && !isReferencedByAnotherNode(n));

  if (roots.length <= 1) {
    return null; // Skip if 1 or 0 roots (no need to split actual use cases)
  }

  const getReachableNodes = (startNode: NodeMeta) => {
    const reachable = new Set<NodeMeta>();
    const queue = [startNode];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (!reachable.has(current)) {
        reachable.add(current);
        current.dependencies.forEach(dep => queue.push(dep));
      }
    }
    return reachable;
  };

  const rootReachability = new Map<NodeMeta, Set<NodeMeta>>();
  roots.forEach(root => {
    rootReachability.set(root, getReachableNodes(root));
  });

  const auxiliaries = nodesMeta.filter(n => !roots.includes(n));
  const sharedAuxiliaries = new Set<NodeMeta>();
  const exclusiveAuxiliaries = new Map<NodeMeta, NodeMeta>();
  
  // Side effects (e.g. `console.log("init")`) define no names and are not exported.
  // They should be copied to all roots so their behavior is preserved.
  const sideEffects = new Set<NodeMeta>();

  auxiliaries.forEach(aux => {
    if (aux.definedNames.length === 0 && !aux.isExported) {
       sideEffects.add(aux);
       return; // Don't process reachability for pure side effects
    }

    const reachingRoots = roots.filter(root => rootReachability.get(root)!.has(aux));
    if (reachingRoots.length > 1) {
      sharedAuxiliaries.add(aux);
    } else if (reachingRoots.length === 1) {
      exclusiveAuxiliaries.set(aux, reachingRoots[0]);
    } else {
      sharedAuxiliaries.add(aux); // Unreachable/dead code goes to helpers
    }
  });

  const getExportName = (node: NodeMeta, index: number = 0) => {
    const ast = node.astNode;
    if (ast.type === 'ExportDefaultDeclaration') {
      if (ast.declaration.id && ast.declaration.id.name) {
        return ast.declaration.id.name;
      }
      return 'index';
    }
    if (node.definedNames.length > 0) {
      return node.definedNames[0];
    }
    if (ast.type === 'ExportNamedDeclaration' && ast.specifiers && ast.specifiers.length > 0) {
      return ast.specifiers[0].exported.name;
    }
    return `useCase_${index}`;
  };

  // Prepare directories
  const filePath = fileInfo.path;
  const dirName = path.dirname(filePath);
  const extName = path.extname(filePath);
  const baseName = path.basename(filePath, extName);
  
  const newDirPath = path.join(dirName, baseName);
  const isDryRun = options.dry || options.d;

  if (!isDryRun && !fs.existsSync(newDirPath)) {
    fs.mkdirSync(newDirPath, { recursive: true });
  }

  const exportLocationMap = new Map<string, string>();

  nodesMeta.forEach((node, index) => {
    if (node.isExported) {
      let targetFileName = 'helpers';
      if (roots.includes(node)) {
        targetFileName = getExportName(node, index);
      } else {
        const owner = exclusiveAuxiliaries.get(node);
        if (owner) {
          targetFileName = getExportName(owner, roots.indexOf(owner));
        }
      }
      
      node.definedNames.forEach(name => exportLocationMap.set(name, targetFileName));
      
      if (node.astNode.type === 'ExportNamedDeclaration' && node.astNode.specifiers) {
         node.astNode.specifiers.forEach((spec: any) => {
            if (spec.exported && spec.exported.type === 'Identifier') {
               exportLocationMap.set(spec.exported.name, targetFileName);
            }
         });
      }
      if (node.astNode.type === 'ExportDefaultDeclaration') {
         exportLocationMap.set('default', targetFileName);
      }
    }
  });

  const getRequiredImports = (activeRefs: Set<string>) => {
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

  // Generate helpers.ts
  if (sharedAuxiliaries.size > 0) {
    const refs = new Set<string>();
    const sharedFileNodes: any[] = [];
    
    sharedAuxiliaries.forEach(node => {
      node.referencedNames.forEach(r => refs.add(r));
      
      let ast = node.astNode;
      // If a shared auxiliary isn't exported, we must export it so the Root files can import it
      if (!node.isExported) {
        if (
          ast.type === 'FunctionDeclaration' || 
          ast.type === 'ClassDeclaration' || 
          ast.type === 'VariableDeclaration' || 
          ast.type === 'TSTypeAliasDeclaration' || 
          ast.type === 'TSInterfaceDeclaration' || 
          ast.type === 'TSEnumDeclaration'
        ) {
          ast = j.exportNamedDeclaration(ast);
        }
      }
      sharedFileNodes.push(ast);
    });

    const reqImports = getRequiredImports(refs);
    
    const sharedAst = j.program([...reqImports, ...sharedFileNodes]);
    const sharedSource = j(sharedAst).toSource({ quote: 'single', trailingComma: true });
    const sharedFilePath = path.join(newDirPath, `helpers${extName}`);
    
    if (!isDryRun) {
      if (fs.existsSync(sharedFilePath)) {
         console.error(`[Error] File ${sharedFilePath} already exists. Skipping file split to prevent data loss.`);
         return null;
      }
      fs.writeFileSync(sharedFilePath, sharedSource, 'utf-8');
    } else {
      console.log(`\n[Dry Run] Would create: ${sharedFilePath}\n`);
    }
  }

  // To prevent partial writes on failure, collect files to write:
  const filesToWrite = new Map<string, string>();

  // Generate Root files
  for (let index = 0; index < roots.length; index++) {
    const rootNode = roots[index];
    const expName = getExportName(rootNode, index);
    
    const myAuxiliaries: NodeMeta[] = [];
    exclusiveAuxiliaries.forEach((owner, aux) => {
      if (owner === rootNode) myAuxiliaries.push(aux);
    });

    const myNodes = [rootNode, ...myAuxiliaries, ...sideEffects];
    const myRefs = new Set<string>();
    myNodes.forEach(n => n.referencedNames.forEach(r => myRefs.add(r)));

    const reqImports = getRequiredImports(myRefs);

    const neededShared = new Set<string>();
    sharedAuxiliaries.forEach(sharedNode => {
      sharedNode.definedNames.forEach(name => {
        if (myRefs.has(name)) {
          neededShared.add(name);
        }
      });
    });

    if (neededShared.size > 0) {
      const specifiers = Array.from(neededShared).map(name => j.importSpecifier(j.identifier(name)));
      reqImports.push(j.importDeclaration(specifiers, j.literal('./helpers')));
    }

    const newAstNodes = [
      ...reqImports,
      ...Array.from(sideEffects).map(n => n.astNode),
      ...myAuxiliaries.map(n => n.astNode),
      rootNode.astNode
    ];

    const newAst = j.program(newAstNodes);
    const newSource = j(newAst).toSource({ quote: 'single', trailingComma: true });
    const newFilePath = path.join(newDirPath, `${expName}${extName}`);
    
    if (!isDryRun && fs.existsSync(newFilePath)) {
       console.error(`[Error] Target file already exists: ${newFilePath}. Skipping to prevent data loss.`);
       return null;
    }
    
    filesToWrite.set(newFilePath, newSource);
  }

  // Update imports across project FIRST before deleting original file
  const srcDir = path.resolve(process.cwd(), 'src');
  const allFiles = getAllTsFiles(srcDir);
  
  const filesToUpdate = new Map<string, string>();

  try {
    allFiles.forEach(importerPath => {
      if (importerPath === filePath) return;

      let content = fs.readFileSync(importerPath, 'utf-8');
      if (!content.includes(baseName)) return;

      const rootAst = j(content);
      let changed = false;

      rootAst.find(j.ImportDeclaration).forEach(pathPath => {
        const source = pathPath.node.source.value;
        if (typeof source !== 'string') return;

        let resolvedSource = '';
        if (source.startsWith('#/')) {
          resolvedSource = path.resolve(process.cwd(), 'src', source.slice(2));
        } else {
          const importerDir = path.dirname(importerPath);
          resolvedSource = path.resolve(importerDir, source);
        }
        
        const fileWithoutExt = filePath.replace(/\.[^.]+$/, '');

        if (resolvedSource === fileWithoutExt || resolvedSource === filePath) {
          const newImportsMap = new Map<string, any[]>();
          
          pathPath.node.specifiers?.forEach((spec: any) => {
            let expOwnerName = '';
            if (spec.type === 'ImportSpecifier') {
              const importedName = spec.imported.name;
              expOwnerName = exportLocationMap.get(importedName) || '';
            } else if (spec.type === 'ImportDefaultSpecifier') {
              expOwnerName = exportLocationMap.get('default') || '';
            }

            if (expOwnerName) {
              const targetSource = `${source}/${expOwnerName}`;
              if (!newImportsMap.has(targetSource)) {
                newImportsMap.set(targetSource, []);
              }
              newImportsMap.get(targetSource)!.push(spec);
            } else {
               // Fallback: keep the original import if we couldn't resolve its new location
               if (!newImportsMap.has(source)) {
                 newImportsMap.set(source, []);
               }
               newImportsMap.get(source)!.push(spec);
            }
          });

          if (newImportsMap.size > 0) {
            const newImportNodes = Array.from(newImportsMap.entries()).map(([src, specifiers]) => 
              j.importDeclaration(specifiers, j.literal(src))
            );
            j(pathPath).replaceWith(newImportNodes);
            changed = true;
          }
        }
      });

      if (changed) {
        filesToUpdate.set(importerPath, rootAst.toSource({ quote: 'single', trailingComma: true }));
      }
    });

  } catch (error) {
     console.error(`[Error] Failed to scan and update cross-project imports. File split aborted for safety.`, error);
     return null;
  }

  // All safe. Execute file writes.
  if (!isDryRun) {
    filesToWrite.forEach((source, targetPath) => {
       fs.writeFileSync(targetPath, source, 'utf-8');
    });
    
    filesToUpdate.forEach((source, targetPath) => {
       fs.writeFileSync(targetPath, source, 'utf-8');
    });

    // Delete original file LAST
    fs.unlinkSync(filePath);
  } else {
    filesToWrite.forEach((source, targetPath) => {
       console.log(`\n[Dry Run] Would create: ${targetPath}\n`);
    });
    filesToUpdate.forEach((source, targetPath) => {
       console.log(`\n[Dry Run] Would update imports in: ${targetPath}\n`);
    });
    console.log(`\n[Dry Run] Would delete original file: ${filePath}\n`);
  }

  return null;
}

export const parser = 'tsx';
