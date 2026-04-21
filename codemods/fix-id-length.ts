import { FileInfo, API, Options } from 'jscodeshift';

export default function transform(fileInfo: FileInfo, api: API, options: Options) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  let hasModifications = false;

  const renameMap: Record<string, string> = {
    i: 'index', j: 'jIndex', k: 'kIndex', e: 'event', v: 'value',
    t: 'time', n: 'node', p: 'param',
    b: 'buffer', a: 'alpha', c: 'context', d: 'data', f: 'freq',
    g: 'gain', l: 'length', m: 'message', o: 'output',
    q: 'query', s: 'state', u: 'user'
  };

  root.find(j.Identifier).forEach((path) => {
    const name = path.node.name;
    if (name.length === 1 && renameMap[name]) {
      const scope = path.scope;
      if (scope && scope.isGlobal) return; // Don't rename global variables
      if (scope && scope.declares(name)) {
        
        let newName = renameMap[name];
        let counter = 1;
        while (scope.declares(newName) || scope.lookup(newName)) {
          newName = renameMap[name] + counter;
          counter++;
        }
        
        j(path).closestScope().find(j.Identifier, { name }).forEach((refPath) => {
          if (
            refPath.parent.node.type === 'MemberExpression' &&
            refPath.parent.node.property === refPath.node &&
            !refPath.parent.node.computed
          ) {
            return;
          }
          if (
            refPath.parent.node.type === 'Property' &&
            refPath.parent.node.key === refPath.node &&
            !refPath.parent.node.computed &&
            refPath.parent.node.shorthand === false
          ) {
            return;
          }

          let currentScope = refPath.scope;
          while (currentScope && !currentScope.declares(name)) {
            currentScope = currentScope.parent;
          }
          if (currentScope === scope) {
            if (refPath.parent.node.type === 'Property' && refPath.parent.node.shorthand) {
                refPath.parent.node.shorthand = false;
                refPath.parent.node.key = j.identifier(name);
                refPath.parent.node.value = j.identifier(newName);
            } else {
                refPath.node.name = newName;
            }
            hasModifications = true;
          }
        });
      }
    }
  });

  return hasModifications ? root.toSource() : null;
}

export const parser = 'tsx';