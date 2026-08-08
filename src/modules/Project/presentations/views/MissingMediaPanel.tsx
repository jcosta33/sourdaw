import { type ReactElement, useEffect, useRef, useState } from 'react';

import { AlertTriangle } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';

import {
    defaultMissingMediaStoreState,
    type MissingMediaItem,
    missingMediaStore,
} from '../../stores/missingMediaStore';

/** Frozen tracks have no relink affordance — the repair is to unfreeze and
 * re-render — so the two kinds get different guidance. */
function describeRepair(item: MissingMediaItem): string {
    if (item.kind === 'frozenTrack') {
        return 'Unfreeze the track to re-render its audio';
    }
    return 'Drop a replacement file on the clip to relink it';
}

export const MissingMediaPanel = (): ReactElement | null => {
    const missingMedia = useStore(missingMediaStore, defaultMissingMediaStoreState);
    const [open, setOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const handleClickOutside = (event: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [open]);

    const items = missingMedia.items;
    if (items.length === 0) {
        return null;
    }

    const count = items.length;
    const summary = `${String(count)} missing ${count === 1 ? 'file' : 'files'}`;

    return (
        <div className="relative" ref={panelRef}>
            <Button
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label={`${summary} — show details`}
                onClick={() => {
                    setOpen(!open);
                }}
                size="sm"
                variant="ghost"
            >
                <AlertTriangle aria-hidden="true" size={14} />
                <span>{summary}</span>
            </Button>

            {open ? (
                <div
                    aria-label="Missing media"
                    className="absolute top-full left-0 z-50 mt-1 w-80 rounded-md border border-white/10 bg-neutral-900 p-2 shadow-lg"
                    role="dialog"
                >
                    <p className="px-2 py-1 text-xs text-neutral-400">
                        The project opened without this audio. Playback is silent where it is referenced.
                    </p>
                    <ul className="max-h-64 overflow-y-auto">
                        {items.map((item) => (
                            <li className="px-2 py-1.5" key={`${item.kind}:${item.trackId}:${item.bufferId}`}>
                                <p className="text-sm">{item.label}</p>
                                <p className="text-xs text-neutral-400">{item.trackName}</p>
                                <p className="text-xs text-neutral-500">{describeRepair(item)}</p>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
};
