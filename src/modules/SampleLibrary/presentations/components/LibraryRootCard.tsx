/**
 * LibraryRootCard — shows a connected folder root with status and actions.
 */
import { type ReactElement } from 'react';

import { HardDrive, RefreshCw, X, ShieldAlert } from 'lucide-react';

import { Button } from '#/components/ui/button';

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
}: LibraryRootCardProps): ReactElement => {
    let statusIconClass = 'text-muted-foreground/30';
    let statusText = 'Offline';

    if (root.status === 'ready') {
        statusIconClass = 'text-emerald-400';
        statusText = `${root.fileCount} files`;
    } else if (root.status === 'scanning') {
        statusIconClass = 'text-amber-400 animate-pulse';
        statusText = 'Scanning...';
    } else if (root.status === 'permission_required') {
        statusIconClass = 'text-amber-500';
        statusText = 'Click to restore access';
    }

    return (
        <div
            role="button"
            tabIndex={0}
            aria-pressed={isActive}
            aria-label={`Library folder ${root.name}, ${statusText}`}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md border cursor-pointer transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-cyan/60 ${
                isActive ? 'border-white/10 bg-white/[0.06]' : 'border-transparent hover:bg-white/[0.03]'
            }`}
            onClick={onSelect}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect();
                }
            }}
        >
            <HardDrive className={`size-3.5 shrink-0 ${statusIconClass}`} aria-hidden="true" />
            <div className="flex-1 min-w-0">
                <div className="text-[10px] font-medium text-foreground truncate">{root.name}</div>
                <div className="text-[8px] text-muted-foreground/50">{statusText}</div>
            </div>

            {root.status === 'permission_required' && onRequestPermission ? (
                <Button
                    variant="bare"
                    size="bare"
                    type="button"
                    aria-label={`Restore access to ${root.name}`}
                    className="size-4 rounded flex items-center justify-center text-amber-500 hover:bg-amber-500/10"
                    onClick={(e) => {
                        e.stopPropagation();
                        onRequestPermission();
                    }}
                    title="Restore access"
                >
                    <ShieldAlert className="size-3" />
                </Button>
            ) : null}

            <Button
                variant="bare"
                size="bare"
                type="button"
                aria-label={`Rescan ${root.name}`}
                className="size-4 rounded flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-white/10"
                onClick={(e) => {
                    e.stopPropagation();
                    onRescan();
                }}
                title="Rescan"
            >
                <RefreshCw className={`size-3 ${root.status === 'scanning' ? 'animate-spin' : ''}`} />
            </Button>

            <Button
                variant="bare"
                size="bare"
                type="button"
                aria-label={`Disconnect ${root.name}`}
                className="size-4 rounded flex items-center justify-center text-muted-foreground/30 hover:text-red-400 hover:bg-red-500/10"
                onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                }}
                title="Disconnect"
            >
                <X className="size-3" />
            </Button>
        </div>
    );
};
