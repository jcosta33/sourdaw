import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AlertTriangle } from 'lucide-react';
import { createPortal } from 'react-dom';

import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';

import {
    defaultMissingMediaStoreState,
    type MissingMediaItem,
    missingMediaStore,
} from '../../stores/missingMediaStore';

const MISSING_MEDIA_PANEL_WIDTH = 20 * 16;
const VIEWPORT_EDGE_GAP = 12;

/** Frozen tracks have no relink affordance — the repair is to unfreeze and
 * re-render — so the two kinds get different guidance. */
function describeRepair(item: MissingMediaItem): string {
    if (item.kind === 'frozenTrack') {
        return 'Unfreeze the track to re-render its audio';
    }
    return 'Drop a replacement file on the clip to relink it';
}

/** `bufferId` is not unique per row: splitting or duplicating a clip leaves two
 * clips on one track sharing a source buffer, which is identical in kind,
 * track and buffer. The clip id is the only disambiguator, and a frozen track
 * has exactly one frozen buffer, so its track id serves. */
function rowKey(item: MissingMediaItem): string {
    if (item.kind === 'frozenTrack') {
        return `frozenTrack:${item.trackId}`;
    }
    return `clip:${item.clipId ?? item.bufferId}`;
}

export const MissingMediaPanel = (): ReactElement | null => {
    const missingMedia = useStore(missingMediaStore, defaultMissingMediaStoreState);
    const [open, setOpen] = useState(false);
    const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });
    const triggerContainerRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            const clickedTrigger = triggerContainerRef.current?.contains(target) ?? false;
            const clickedPanel = panelRef.current?.contains(target) ?? false;
            if (!clickedTrigger && !clickedPanel) {
                setOpen(false);
            }
        };
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
        };

        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('keydown', handleEscape, true);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('keydown', handleEscape, true);
        };
    }, [open]);

    useLayoutEffect(() => {
        if (!open) {
            return undefined;
        }

        const updatePanelPosition = (): void => {
            const triggerRect = triggerContainerRef.current?.getBoundingClientRect();
            const panelRect = panelRef.current?.getBoundingClientRect();
            if (!triggerRect || !panelRect) {
                return;
            }

            const panelWidth = Math.min(MISSING_MEDIA_PANEL_WIDTH, window.innerWidth - VIEWPORT_EDGE_GAP * 2);
            setPanelPosition({
                top: Math.min(
                    Math.max(VIEWPORT_EDGE_GAP, triggerRect.bottom + 4),
                    Math.max(VIEWPORT_EDGE_GAP, window.innerHeight - panelRect.height - VIEWPORT_EDGE_GAP)
                ),
                left: Math.min(
                    Math.max(VIEWPORT_EDGE_GAP, triggerRect.left),
                    window.innerWidth - panelWidth - VIEWPORT_EDGE_GAP
                ),
            });
        };

        updatePanelPosition();
        window.addEventListener('resize', updatePanelPosition);
        return () => window.removeEventListener('resize', updatePanelPosition);
    }, [open, missingMedia.items]);

    const items = missingMedia.items;
    if (items.length === 0) {
        return null;
    }

    // The headline counts *files*, not references: a clip split in two is one
    // file the user has to find, not two. The row count can exceed it, so the
    // detail view states both when they diverge.
    const fileCount = new Set(items.map((item) => item.bufferId)).size;
    const summary = `${String(fileCount)} missing ${fileCount === 1 ? 'file' : 'files'}`;
    const referenceNote =
        items.length === fileCount
            ? null
            : `Used by ${String(items.length)} clips and tracks — relinking a file repairs every place it is used.`;
    return (
        <div className="relative" ref={triggerContainerRef}>
            <Button
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label={`${summary} — show details`}
                onClick={() => setOpen((previousOpen) => !previousOpen)}
                size="sm"
                variant="ghost"
            >
                <AlertTriangle aria-hidden="true" size={14} />
                <span>{summary}</span>
            </Button>

            {open
                ? createPortal(
                      <div
                          ref={panelRef}
                          aria-label="Missing media"
                          className="fixed z-50 w-80 rounded-md border border-white/10 bg-neutral-900 p-2 shadow-lg"
                          style={{
                              ...panelPosition,
                              maxWidth: 'min(20rem, calc(100vw - 1.5rem))',
                              maxHeight: 'calc(100vh - 1.5rem)',
                          }}
                          role="dialog"
                      >
                          <p className="px-2 py-1 text-xs text-neutral-400">
                              The project opened without this audio. Playback is silent where it is referenced.
                          </p>
                          {referenceNote ? <p className="px-2 py-1 text-xs text-neutral-400">{referenceNote}</p> : null}
                          <ul className="max-h-64 overflow-y-auto">
                              {items.map((item) => (
                                  <li className="px-2 py-1.5" key={rowKey(item)}>
                                      <p className="text-sm">{item.label}</p>
                                      <p className="text-xs text-neutral-400">{item.trackName}</p>
                                      <p className="text-xs text-neutral-500">{describeRepair(item)}</p>
                                  </li>
                              ))}
                          </ul>
                      </div>,
                      document.body
                  )
                : null}
        </div>
    );
};
