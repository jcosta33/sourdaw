/**
 * FolderTree — browsable folder hierarchy with expand/collapse.
 */
import { type ReactElement } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';
import { type FolderNode } from '../../models/LibraryTypes';

type FolderTreeProps = {
    nodes: FolderNode[];
    currentFolder: string | null;
    onFolderSelect: (path: string) => void;
    onToggleExpand: (path: string) => void;
    depth?: number;
};

export const FolderTree = ({
    nodes,
    currentFolder,
    onFolderSelect,
    onToggleExpand,
    depth = 0,
}: FolderTreeProps): ReactElement => (
    <div className="space-y-0">
        {nodes.map((node) => {
            const isActive = currentFolder === node.path;
            const isExpanded = node.expanded;
            const hasChildren = node.children.length > 0;
            const FolderIcon = isExpanded ? FolderOpen : Folder;
            const ArrowIcon = isExpanded ? ChevronDown : ChevronRight;

            return (
                <div key={node.path || node.name}>
                    <button
                        type="button"
                        className={`flex items-center gap-1 w-full text-left py-0.5 rounded transition-colors ${
                            isActive
                                ? 'bg-white/[0.08] text-foreground'
                                : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                        }`}
                        style={{ paddingLeft: `${depth * 12 + 4}px` }}
                        onClick={() => {
                            onFolderSelect(node.path);
                            if (hasChildren) {
                                onToggleExpand(node.path);
                            }
                        }}
                    >
                        {hasChildren ? (
                            <ArrowIcon className="size-3 shrink-0 text-muted-foreground/50" />
                        ) : (
                            <span className="size-3 shrink-0" />
                        )}
                        <FolderIcon className="size-3 shrink-0 text-amber-500/60" />
                        <span className="text-[10px] truncate flex-1">{node.name}</span>
                        <span className="text-[8px] text-muted-foreground/40 pr-1">{node.fileCount}</span>
                    </button>
                    {isExpanded && hasChildren ? (
                        <FolderTree
                            nodes={node.children}
                            currentFolder={currentFolder}
                            onFolderSelect={onFolderSelect}
                            onToggleExpand={onToggleExpand}
                            depth={depth + 1}
                        />
                    ) : null}
                </div>
            );
        })}
    </div>
);
