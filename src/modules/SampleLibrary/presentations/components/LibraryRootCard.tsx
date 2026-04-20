/**
 * LibraryRootCard — shows a connected folder root with status and actions.
 */
import { type ReactElement } from 'react';

import { HardDrive, RefreshCw, X, ShieldAlert } from 'lucide-react';

import { type LibraryRoot } from '../../models/LibraryTypes';

type LibraryRootCardProps = {
    root: LibraryRoot;
    isActive: boolean;
    onSelect: () => void;
    onRescan: () => void;
    onRemove: () => void;
    onRequestPermission?: () => void;
};

export const LibraryRootCard = ({
    root,
    isActive,
    onSelect,
    onRescan,
    onRemove,
    onRequestPermission,
}: LibraryRootCardProps): ReactElement => (
    <div
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md border cursor-pointer transition-colors ${
            isActive ? 'border-white/10 bg-white/[0.06]' : 'border-transparent hover:bg-white/[0.03]'
        }`}
        onClick={onSelect}
    >
        <HardDrive
            className={`size-3.5 shrink-0 ${
                root.status === 'ready'
                    ? 'text-emerald-400'
                    : root.status === 'scanning'
                      ? 'text-amber-400 animate-pulse'
                      : root.status === 'permission_required'
                        ? 'text-amber-500'
                        : 'text-muted-foreground/30'
            }`}
        />
        <div className="flex-1 min-w-0">
            <div className="text-[10px] font-medium text-foreground truncate">{root.name}</div>
            <div className="text-[8px] text-muted-foreground/50">
                {root.status === 'scanning'
                    ? 'Scanning...'
                    : root.status === 'ready'
                      ? `${root.fileCount} files`
                      : root.status === 'permission_required'
                        ? 'Click to restore access'
                        : 'Offline'}
            </div>
        </div>

        {root.status === 'permission_required' && onRequestPermission ? (
            <button
                type="button"
                className="size-4 rounded flex items-center justify-center text-amber-500 hover:bg-amber-500/10"
                onClick={(e) => {
                    e.stopPropagation();
                    onRequestPermission();
                }}
                title="Restore access"
            >
                <ShieldAlert className="size-3" />
            </button>
        ) : null}

        <button
            type="button"
            className="size-4 rounded flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-white/10"
            onClick={(e) => {
                e.stopPropagation();
                onRescan();
            }}
            title="Rescan"
        >
            <RefreshCw className={`size-3 ${root.status === 'scanning' ? 'animate-spin' : ''}`} />
        </button>

        <button
            type="button"
            className="size-4 rounded flex items-center justify-center text-muted-foreground/30 hover:text-red-400 hover:bg-red-500/10"
            onClick={(e) => {
                e.stopPropagation();
                onRemove();
            }}
            title="Disconnect"
        >
            <X className="size-3" />
        </button>
    </div>
);
