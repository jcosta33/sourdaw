import { type ReactElement, type ReactNode, useState } from "react";
import { cn } from "#/helpers/Styles/cn";
import { removeTrack } from "../../useCases/removeTrack";
import { addClip } from "../../useCases/clipUseCases";
import type { Track } from "../../models/Track";

type TrackContextMenuProps = {
    track: Track;
    children: ReactNode;
};

type MenuPosition = { x: number; y: number } | null;

export const TrackContextMenu = ({ track, children }: TrackContextMenuProps): ReactElement => {
    const [position, setPosition] = useState<MenuPosition>(null);

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setPosition({ x: e.clientX, y: e.clientY });
    };

    const close = () => setPosition(null);

    const actions = [
        { label: "Add Clip", action: () => { addClip({ trackId: track.id, startBeat: 0, endBeat: 16, name: `Clip ${Date.now() % 1000}` }); close(); } },
        { label: "Duplicate Track", action: () => { close(); } },
        { label: "---", action: () => {} },
        { label: "Delete Track", action: () => { removeTrack(track.id); close(); }, destructive: true },
    ];

    return (
        <div onContextMenu={handleContextMenu}>
            {children}

            {position && (
                <>
                    <div className="fixed inset-0 z-40" onClick={close} />
                    <div
                        className="fixed z-50 min-w-36 rounded-md border border-border bg-popover p-1 shadow-lg"
                        style={{ left: position.x, top: position.y }}
                        role="menu"
                    >
                        {actions.map((item, i) =>
                            item.label === "---" ? (
                                <div key={i} className="my-1 h-px bg-border" />
                            ) : (
                                <button
                                    key={i}
                                    role="menuitem"
                                    className={cn(
                                        "flex w-full items-center rounded-sm px-2 py-1.5 text-xs",
                                        "hover:bg-accent",
                                        "destructive" in item && item.destructive && "text-destructive-foreground hover:bg-destructive/20",
                                    )}
                                    onClick={item.action}
                                >
                                    {item.label}
                                </button>
                            ),
                        )}
                    </div>
                </>
            )}
        </div>
    );
};
