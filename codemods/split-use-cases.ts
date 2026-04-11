/**
 * Splits a TypeScript module that contains multiple exported "roots" into:
 * - one file per root under `<originalBasename>/`
 * - optional `helpers.ts` for symbols shared by more than one root
 *
 * By default: rewrites imports across `src/` and deletes the original file (no barrel).
 * Use `--barrel` to keep a re-export shim at the old path instead.
 *
 * Note: jscodeshift reports 0 "ok" / many "skipped" because the transform returns `null` and writes
 * via the filesystem instead of returning modified `fileInfo.source`.
 */
import { FileInfo, API, Options } from 'jscodeshift';
import * as fs from 'fs';
import * as path from 'path';

function getAllTsFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (!filePath.includes('node_modules') && !filePath.includes('.git') && !filePath.includes('dist')) {
        results = results.concat(getAllTsFiles(filePath));
      }
    } else if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      results.push(filePath);
    }
  }
  return results;
}

function resolveImportToAbsolute(importerPath: string, source: string): string {
  const absImporter = path.isAbsolute(importerPath)
    ? importerPath
    : path.resolve(process.cwd(), importerPath);
  if (source.startsWith('#/')) {
    return path.resolve(process.cwd(), 'src', source.slice(2));
  }
  return path.resolve(path.dirname(absImporter), source);
}

function pathMatchesSplitTarget(resolved: string, targetFilePath: string): boolean {
  const norm = path.normalize(resolved);
  const absTarget = path.isAbsolute(targetFilePath)
    ? path.normalize(targetFilePath)
    : path.resolve(process.cwd(), targetFilePath);
  const noExt = absTarget.replace(/\.[^.]+$/, '');
  if (norm === noExt || norm === absTarget) return true;
  const base = path.basename(absTarget);
  if ((base === 'index.ts' || base === 'index.tsx') && norm === path.dirname(absTarget)) {
    return true;
  }
  return false;
}

function appendSubPath(source: string, sub: string): string {
  const s = source.replace(/\/$/, '');
  return `${s}/${sub}`;
}

interface NodeMeta {
  astNode: any;
  isExported: boolean;
  isBehavioral: boolean;
  definedNames: string[];
  referencedNames: Set<string>;
  dependencies: Set<NodeMeta>;
}

export default function transform(fileInfo: FileInfo, api: API, options: Options) {
  const ext = path.extname(fileInfo.path);
  if (path.basename(fileInfo.path, ext) === 'index') {
    return null;
  }

  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  const imports = root.find(j.ImportDeclaration).nodes();
  const program = root.find(j.Program).get();
  const topLevelNodes = program.node.body;

  const nodesMeta: NodeMeta[] = [];

  const extractDefinedNames = (decl: any) => {
    const names: string[] = [];
    if (!decl) return names;

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
           if (d.id.type === 'Identifier') {
             names.push(d.id.name);
           } else {
             // Handle destructuring
             j(d.id).find(j.Identifier).forEach(p => names.push(p.node.name));
           }
        }
      });
    }
    return names;
  };

  const isBehavioralNode = (node: any): boolean => {
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) return isBehavioralNode(node.declaration);
      if (node.exportKind === 'type') return false;
      return true; 
    }
    if (node.type === 'ExportDefaultDeclaration') {
      return true;
    }
    if (
      node.type === 'FunctionDeclaration' || 
      node.type === 'ClassDeclaration' || 
      node.type === 'VariableDeclaration'
    ) {
      return true;
    }
    return false;
  };

  topLevelNodes.forEach((node: any) => {
    if (node.type === 'ImportDeclaration') return;
    
    const meta: NodeMeta = {
      astNode: node,
      isExported: false,
      isBehavioral: isBehavioralNode(node),
      definedNames: [],
      referencedNames: new Set(),
      dependencies: new Set()
    };

    if (node.type === 'ExportNamedDeclaration') {
      meta.isExported = true;
      if (node.declaration) {
        meta.definedNames = extractDefinedNames(node.declaration);
      } else if (node.specifiers) {
        node.specifiers.forEach((spec: any) => {
          if (spec.exported && spec.exported.type === 'Identifier') {
            meta.definedNames.push(spec.exported.name);
          }
        });
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

    const findIdentifiers = (ast: any) => {
       j(ast).find(j.Identifier).forEach(p => {
          const parent = p.parentPath.node;
          if (parent.type === 'Property' && parent.key === p.node && !parent.computed) return; 
          if (parent.type === 'MemberExpression' && parent.property === p.node && !parent.computed) return;
          if (meta.definedNames.includes(p.node.name)) return;
          meta.referencedNames.add(p.node.name);
       });
       j(ast).find(j.JSXIdentifier).forEach(p => {
          if (meta.definedNames.includes(p.node.name)) return;
          meta.referencedNames.add(p.node.name);
       });
    };
    
    findIdentifiers(node);
    nodesMeta.push(meta);
  });

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

  let roots = nodesMeta.filter(n => n.isExported && n.isBehavioral && !isReferencedByAnotherNode(n));

  if (roots.length === 0) {
     const exportedBehavioral = nodesMeta.filter(n => n.isExported && n.isBehavioral);
     if (exportedBehavioral.length > 1) {
        roots = exportedBehavioral;
     }
  }

  if (roots.length <= 1) {
    return null;
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
  const sideEffects = new Set<NodeMeta>();

  auxiliaries.forEach(aux => {
    if (aux.definedNames.length === 0 && !aux.isExported) {
       sideEffects.add(aux);
       return;
    }

    const reachingRoots = roots.filter(root => rootReachability.get(root)!.has(aux));
    if (reachingRoots.length > 1) {
      sharedAuxiliaries.add(aux);
    } else if (reachingRoots.length === 1) {
      exclusiveAuxiliaries.set(aux, reachingRoots[0]);
    } else {
      sharedAuxiliaries.add(aux); 
    }
  });

  const getExportName = (node: NodeMeta, index: number = 0) => {
    const ast = node.astNode;
    if (ast.type === 'ExportDefaultDeclaration') {
      if (ast.declaration.id && ast.declaration.id.name) return ast.declaration.id.name;
      return 'index';
    }
    if (node.definedNames.length > 0) return node.definedNames[0];
    if (ast.type === 'ExportNamedDeclaration' && ast.specifiers && ast.specifiers.length > 0) {
      return ast.specifiers[0].exported.name;
    }
    return `useCase_${index}`;
  };

  const reservedRootFileNames = new Set<string>();
  if (sharedAuxiliaries.size > 0) {
    reservedRootFileNames.add('helpers');
  }

  const rootFileNames = roots.map((rootNode, index) => {
    let base = getExportName(rootNode, index);
    let candidate = base;
    let n = 0;
    while (reservedRootFileNames.has(candidate)) {
      n += 1;
      candidate = `${base}_${n}`;
    }
    reservedRootFileNames.add(candidate);
    return candidate;
  });

  const exportLocationMap = new Map<string, string>();
  nodesMeta.forEach(node => {
    if (node.isExported) {
      let targetFileName = 'helpers';
      if (roots.includes(node)) {
        targetFileName = rootFileNames[roots.indexOf(node)];
      } else {
        const owner = exclusiveAuxiliaries.get(node);
        if (owner) targetFileName = rootFileNames[roots.indexOf(owner)];
      }
      node.definedNames.forEach(name => exportLocationMap.set(name, targetFileName));
      if (node.astNode.type === 'ExportNamedDeclaration' && node.astNode.specifiers) {
        node.astNode.specifiers.forEach((spec: any) => {
          if (spec.exported && spec.exported.type === 'Identifier') {
            exportLocationMap.set(spec.exported.name, targetFileName);
          }
        });
      }
      if (node.astNode.type === 'ExportDefaultDeclaration') exportLocationMap.set('default', targetFileName);
    }
  });

  const useBarrel = options.barrel === true || options.barrel === 'true';

  const filePath = fileInfo.path;
  const dirName = path.dirname(filePath);
  const extName = path.extname(filePath);
  const baseName = path.basename(filePath, extName);
  const newDirPath = path.join(dirName, baseName);
  const isDryRun = options.dry || options.d;

  if (!isDryRun && !fs.existsSync(newDirPath)) {
    fs.mkdirSync(newDirPath, { recursive: true });
  }

  const getRequiredImports = (activeRefs: Set<string>, targetFileDepthIncrease: number) => {
    const reqImports: any[] = [];
    imports.forEach((imp: any) => {
      const neededSpecifiers = (imp.specifiers || []).filter((spec: any) => {
        if (spec.type === 'ImportSpecifier' && spec.local?.type === 'Identifier') {
          return activeRefs.has(spec.local.name);
        }
        if (spec.type === 'ImportDefaultSpecifier' && spec.local?.type === 'Identifier') {
          return activeRefs.has(spec.local.name);
        }
        if (spec.type === 'ImportNamespaceSpecifier' && spec.local?.type === 'Identifier') {
          return activeRefs.has(spec.local.name);
        }
        return false;
      });

      if (neededSpecifiers.length > 0 || !imp.specifiers || imp.specifiers.length === 0) {
        let source = imp.source.value;
        if (source.startsWith('.')) {
           for (let i = 0; i < targetFileDepthIncrease; i++) source = path.join('..', source);
           source = source.replace(/\\/g, '/');
           if (!source.startsWith('.')) source = './' + source;
        }
        reqImports.push(j.importDeclaration(neededSpecifiers.length > 0 ? neededSpecifiers : imp.specifiers, j.literal(source)));
      }
    });
    return reqImports;
  };

  const buildBarrelSource = () => {
    const printOpts = { quote: 'single' as const, trailingComma: true };
    const parts: string[] = [];
    imports.forEach((imp: any) => {
      if (!imp.specifiers || imp.specifiers.length === 0) {
        parts.push(j(imp).toSource(printOpts));
      }
    });
    sideEffects.forEach(node => {
      parts.push(j(node.astNode).toSource(printOpts));
    });
    const sharedExportsPublic = [...sharedAuxiliaries].some(n => n.isExported);
    if (sharedAuxiliaries.size > 0 && sharedExportsPublic) {
      parts.push(`export * from './${baseName}/helpers';`);
    }
    roots.forEach((_, idx) => {
      parts.push(`export * from './${baseName}/${rootFileNames[idx]}';`);
    });
    return parts.join('\n') + '\n';
  };

  const filesToWrite = new Map<string, string>();

  if (sharedAuxiliaries.size > 0) {
    const refs = new Set<string>();
    const sharedFileNodes: any[] = [];
    sharedAuxiliaries.forEach(node => {
      node.referencedNames.forEach(r => refs.add(r));
      let ast = node.astNode;
      if (!node.isExported) {
        if (ast.type === 'FunctionDeclaration' || ast.type === 'ClassDeclaration' || ast.type === 'VariableDeclaration' || ast.type === 'TSTypeAliasDeclaration' || ast.type === 'TSInterfaceDeclaration' || ast.type === 'TSEnumDeclaration') {
          ast = j.exportNamedDeclaration(ast);
        }
      }
      sharedFileNodes.push(ast);
    });
    const reqImports = getRequiredImports(refs, 1);
    const sharedAst = j.program([...reqImports, ...sharedFileNodes]);
    const sharedSource = j(sharedAst).toSource({ quote: 'single', trailingComma: true });
    const sharedFilePath = path.join(newDirPath, `helpers${extName}`);
    if (!isDryRun && fs.existsSync(sharedFilePath)) return null;
    filesToWrite.set(sharedFilePath, sharedSource);
  }

  for (let index = 0; index < roots.length; index++) {
    const rootNode = roots[index];
    const expName = rootFileNames[index];
    const myAuxiliaries: NodeMeta[] = [];
    exclusiveAuxiliaries.forEach((owner, aux) => { if (owner === rootNode) myAuxiliaries.push(aux); });
    const myNodes = [rootNode, ...myAuxiliaries, ...sideEffects];
    const myRefs = new Set<string>();
    myNodes.forEach(n => n.referencedNames.forEach(r => myRefs.add(r)));
    const reqImports = getRequiredImports(myRefs, 1);
    const neededShared = new Set<string>();
    sharedAuxiliaries.forEach(sharedNode => { sharedNode.definedNames.forEach(name => { if (myRefs.has(name)) neededShared.add(name); }); });
    if (neededShared.size > 0) {
      const specifiers = Array.from(neededShared).map(name => j.importSpecifier(j.identifier(name)));
      reqImports.push(j.importDeclaration(specifiers, j.literal('./helpers')));
    }
    const newAstNodes = [...reqImports, ...Array.from(sideEffects).map(n => n.astNode), ...myAuxiliaries.map(n => n.astNode), rootNode.astNode];
    const newAst = j.program(newAstNodes);
    const newSource = j(newAst).toSource({ quote: 'single', trailingComma: true });
    const newFilePath = path.join(newDirPath, `${expName}${extName}`);
    if (!isDryRun && fs.existsSync(newFilePath)) return null;
    filesToWrite.set(newFilePath, newSource);
  }

  const barrelSource = buildBarrelSource();

  const filesToUpdate = new Map<string, string>();

  if (!useBarrel) {
    const srcDir = path.resolve(process.cwd(), 'src');
    const allFiles = getAllTsFiles(srcDir);
    try {
      allFiles.forEach(importerPath => {
        if (importerPath === filePath) return;
        if (!fs.existsSync(importerPath)) return;
        let content = fs.readFileSync(importerPath, 'utf-8');
        if (!content.includes(baseName)) return;
        const rootAst = j(content);
        let changed = false;

        const getOwnerForSpec = (spec: any): string | undefined => {
          if (!spec) return undefined;
          if (spec.type === 'ImportSpecifier' && spec.imported?.type === 'Identifier') {
            return exportLocationMap.get(spec.imported.name);
          }
          if (spec.type === 'ExportSpecifier' && spec.exported?.type === 'Identifier') {
            return exportLocationMap.get(spec.exported.name);
          }
          if (spec.type === 'ImportDefaultSpecifier') {
            return exportLocationMap.get('default');
          }
          return undefined;
        };

        const updateStatement = (pathNode: any) => {
          const srcNode = pathNode.node.source?.value;
          if (typeof srcNode !== 'string') return;
          const resolved = resolveImportToAbsolute(importerPath, srcNode);
          if (!pathMatchesSplitTarget(resolved, filePath)) return;

          if (pathNode.node.type === 'ExportAllDeclaration') {
            const newExports = rootFileNames.map((sub: string) =>
              j.exportAllDeclaration(j.literal(appendSubPath(srcNode, sub)), null)
            );
            j(pathNode).replaceWith(newExports);
            changed = true;
            return;
          }

          const specs = pathNode.node.specifiers;
          if (!specs || specs.length === 0) return;

          const newMap = new Map<string, any[]>();
          let allResolved = true;
          specs.forEach((spec: any) => {
            const owner = getOwnerForSpec(spec);
            if (!owner) {
              allResolved = false;
              return;
            }
            const targetSrc = appendSubPath(srcNode, owner);
            if (!newMap.has(targetSrc)) newMap.set(targetSrc, []);
            newMap.get(targetSrc)!.push(spec);
          });
          if (!allResolved || newMap.size === 0) return;

          const newNodes = Array.from(newMap.entries()).map(([src, specList]) =>
            pathNode.node.type === 'ImportDeclaration'
              ? j.importDeclaration(specList, j.literal(src))
              : j.exportNamedDeclaration(null, specList, j.literal(src))
          );
          j(pathNode).replaceWith(newNodes);
          changed = true;
        };

        rootAst.find(j.ImportDeclaration).forEach(updateStatement);
        rootAst.find(j.ExportNamedDeclaration, { source: (s: any) => !!s }).forEach(updateStatement);
        rootAst.find(j.ExportAllDeclaration).forEach(updateStatement);

        if (changed) filesToUpdate.set(importerPath, rootAst.toSource({ quote: 'single', trailingComma: true }));
      });
    } catch (e) {
      console.error('[split-use-cases] import rewrite failed:', e);
      return null;
    }
  }

  if (!isDryRun) {
    filesToWrite.forEach((srcTxt, targetPath) => fs.writeFileSync(targetPath, srcTxt, 'utf-8'));
    if (useBarrel) {
      fs.writeFileSync(filePath, barrelSource, 'utf-8');
    } else {
      filesToUpdate.forEach((srcTxt, targetPath) => fs.writeFileSync(targetPath, srcTxt, 'utf-8'));
      fs.unlinkSync(filePath);
    }
  } else {
    filesToWrite.forEach((_, p) => console.log(`[Dry Run] Would create: ${p}`));
    if (useBarrel) {
      console.log(`[Dry Run] Would write barrel (replace original): ${filePath}`);
    } else {
      filesToUpdate.forEach((_, p) => console.log(`[Dry Run] Would update imports in: ${p}`));
      console.log(`[Dry Run] Would delete original file: ${filePath}`);
    }
  }
  return null;
}

export const parser = 'tsx';
