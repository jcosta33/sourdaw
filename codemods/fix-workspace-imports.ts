import { FileInfo, API, Options } from 'jscodeshift';
import * as path from 'path';

const symbolMap: Record<string, string> = {
  'workspaceStore': 'stores/workspaceStore',
  'toggleChatPanel': 'useCases/togglePanel/panelToggles',
  'toggleSidebar': 'useCases/togglePanel/panelToggles',
  'toggleInspector': 'useCases/togglePanel/panelToggles',
  'toggleMixer': 'useCases/togglePanel/panelToggles',
  'toggleTrackList': 'useCases/togglePanel/panelToggles',
  'clearClipSelection': 'useCases/workspaceState',
  'toggleVirtualKeyboard': 'useCases/togglePanel/panelToggles',
  'setTrackListWidth': 'useCases/togglePanel/panelToggles',
  'closeScratchPad': 'useCases/togglePanel/panelToggles',
  'openInspector': 'useCases/togglePanel/panelToggles',
  'showDevicePanelForType': 'useCases/panels/devicePanels',
  'openPreferencesDialog': 'useCases/dialogs',
};

export default function transform(fileInfo: FileInfo, api: API, options: Options) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  let changed = false;

  const filePath = fileInfo.path;
  const oldDir = path.dirname(filePath);

  root.find(j.ImportDeclaration).forEach(pathNode => {
    const source = pathNode.node.source.value;
    if (source === '#/modules/Workspace') {
      const newImports = new Map<string, any[]>();

      pathNode.node.specifiers?.forEach((spec: any) => {
        if (spec.type === 'ImportSpecifier') {
          const importedName = spec.imported.name;
          const targetRel = symbolMap[importedName];

          if (targetRel) {
             // targetRel is relative to src/modules/Workspace
             const absoluteTarget = path.resolve(process.cwd(), 'src/modules/Workspace', targetRel);
             let relativePath = path.relative(oldDir, absoluteTarget);
             if (!relativePath.startsWith('.')) {
                relativePath = './' + relativePath;
             }
             relativePath = relativePath.replace(/\\/g, '/');
             
             if (!newImports.has(relativePath)) {
                newImports.set(relativePath, []);
             }
             newImports.get(relativePath)!.push(spec);
          } else {
             // Fallback
             if (!newImports.has(source)) {
                newImports.set(source, []);
             }
             newImports.get(source)!.push(spec);
          }
        }
      });

      if (newImports.size > 0) {
        const nodes = Array.from(newImports.entries()).map(([src, specifiers]) => 
           j.importDeclaration(specifiers, j.literal(src))
        );
        j(pathNode).replaceWith(nodes);
        changed = true;
      }
    }
  });

  return changed ? root.toSource({ quote: 'single', trailingComma: true }) : null;
}

export const parser = 'tsx';