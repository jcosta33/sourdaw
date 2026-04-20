/**
 * FolderTree — browsable folder hierarchy with expand/collapse.
 */
import { type ReactElement } from 'react';

import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';

import { DawHierarchyRow } from '#/components/daw/DawHierarchyRow';

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
                    <DawHierarchyRow
                        active={isActive}
                        depth={depth}
                        className="py-0.5"
                        startSlot={
                            <>
                                {hasChildren ? (
                                    <ArrowIcon className="size-3 shrink-0 text-muted-foreground/50" />
                                ) : (
                                    <span className="size-3 shrink-0" />
                                )}
                                <FolderIcon className="size-3 shrink-0 text-amber-500/60" />
                            </>
                        }
                        title={node.name}
                        endSlot={<span className="pr-1 text-[8px] text-muted-foreground/40">{node.fileCount}</span>}
                        onClick={() => {
                            onFolderSelect(node.path);
                            if (hasChildren) {
                                onToggleExpand(node.path);
                            }
                        }}
                    />
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
