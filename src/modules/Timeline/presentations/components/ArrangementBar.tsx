import { type ReactElement, type MouseEvent as ReactMouseEvent, useState, useRef, useEffect, useSyncExternalStore } from "react";
import { markerStore } from "../../stores/markerStore";
import { addSection, removeSection, renameSection, setSectionColor, reorderSection } from "../../useCases/markerUseCases";
import type { ArrangementSection } from "../../models/Marker";
import { cn } from "#/helpers/Styles/cn";

type ArrangementBarProps = {
    pixelsPerBeat: number;
    scrollX: number;
};

const SECTION_COLORS = [
    "oklch(0.55 0.12 260)",
    "oklch(0.55 0.12 150)",
    "oklch(0.55 0.12 30)",
    "oklch(0.55 0.12 330)",
    "oklch(0.55 0.12 200)",
    "oklch(0.55 0.12 80)",
];

type ContextMenuState =
    | { kind: "none" }
    | { kind: "empty"; x: number; y: number; beat: number }
    | { kind: "section"; x: number; y: number; section: ArrangementSection };

type EditingState = { sectionId: string; name: string } | null;

const BAR_HEIGHT = 22;

export const ArrangementBar = ({ pixelsPerBeat, scrollX }: ArrangementBarProps): ReactElement => {
    const markerState = useSyncExternalStore(
        (cb) => markerStore.subscribe(() => cb()),
        () => markerStore.value,
        () => markerStore.value,
    );

    const sections = markerState?.sections ?? [];
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({ kind: "none" });
    const [editing, setEditing] = useState<EditingState>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editing]);

    useEffect(() => {
        if (contextMenu.kind === "none") return;
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setContextMenu({ kind: "none" });
            }
        };
        window.addEventListener("mousedown", handleClick);
        return () => window.removeEventListener("mousedown", handleClick);
    }, [contextMenu.kind]);

    const handleBarContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const beat = (localX + scrollX) / pixelsPerBeat;

        const hitSection = sections.find((s) => {
            const sx = s.startBeat * pixelsPerBeat - scrollX;
            const sw = (s.endBeat - s.startBeat) * pixelsPerBeat;
            return localX >= sx && localX <= sx + sw;
        });

        if (hitSection) {
            setContextMenu({ kind: "section", x: e.clientX, y: e.clientY, section: hitSection });
        } else {
            setContextMenu({ kind: "empty", x: e.clientX, y: e.clientY, beat });
        }
    };

    const handleAddSection = () => {
        if (contextMenu.kind !== "empty") return;
        const name = "New Section";
        const startBeat = Math.floor(contextMenu.beat);
        const endBeat = startBeat + 16;
        addSection(startBeat, endBeat, name);
        setContextMenu({ kind: "none" });
    };

    const handleDeleteSection = () => {
        if (contextMenu.kind !== "section") return;
        removeSection(contextMenu.section.id);
        setContextMenu({ kind: "none" });
    };

    const handleStartRename = () => {
        if (contextMenu.kind !== "section") return;
        setEditing({ sectionId: contextMenu.section.id, name: contextMenu.section.name });
        setContextMenu({ kind: "none" });
    };

    const commitRename = () => {
        if (!editing) return;
        const trimmed = editing.name.trim();
        if (trimmed) {
            renameSection(editing.sectionId, trimmed);
        }
        setEditing(null);
    };

    const getSectionColor = (section: ArrangementSection, index: number): string => {
        if (section.color && section.color !== "oklch(0.5 0.1 260)") return section.color;
        return SECTION_COLORS[index % SECTION_COLORS.length]!;
    };

    return (
        <div
            className="relative shrink-0 border-b border-border/40 bg-surface-base overflow-hidden select-none"
            style={{ height: BAR_HEIGHT }}
            onContextMenu={handleBarContextMenu}
            role="region"
            aria-label="Arrangement sections"
        >
            {sections.map((section, i) => {
                const left = section.startBeat * pixelsPerBeat - scrollX;
                const width = (section.endBeat - section.startBeat) * pixelsPerBeat;

                if (left + width < 0 || left > 4000) return null;

                const color = getSectionColor(section, i);
                const isEditing = editing?.sectionId === section.id;

                return (
                    <div
                        key={section.id}
                        className={cn(
                            "absolute top-0.5 bottom-0.5 rounded-sm flex items-center overflow-hidden",
                            "border border-white/10 cursor-default",
                        )}
                        style={{
                            left: Math.max(0, left),
                            width: left < 0 ? width + left : width,
                            backgroundColor: color,
                        }}
                        title={section.name}
                    >
                        {isEditing ? (
                            <input
                                ref={inputRef}
                                className="w-full h-full bg-transparent text-[10px] text-white font-medium px-1.5 outline-none"
                                value={editing.name}
                                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                                onBlur={commitRename}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") commitRename();
                                    if (e.key === "Escape") setEditing(null);
                                }}
                            />
                        ) : (
                            <span className="text-[10px] text-white/90 font-medium px-1.5 truncate">
                                {section.name}
                            </span>
                        )}
                    </div>
                );
            })}

            {sections.length === 0 && (
                <div className="flex items-center justify-center h-full">
                    <span className="text-[9px] text-muted-foreground/40">Right-click to add arrangement sections</span>
                </div>
            )}

            {contextMenu.kind !== "none" && (
                <div
                    ref={menuRef}
                    className="fixed z-50 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-md"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                    {contextMenu.kind === "empty" && (
                        <button
                            className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                            onClick={handleAddSection}
                        >
                            Add Section
                        </button>
                    )}
                    {contextMenu.kind === "section" && (
                        <>
                            <button
                                className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                                onClick={handleStartRename}
                            >
                                Rename
                            </button>
                            <div className="px-2 py-1 text-[10px] text-muted-foreground">Color</div>
                            <div className="flex gap-1 px-2 pb-1">
                                {SECTION_COLORS.map((c) => (
                                    <button
                                        key={c}
                                        className="size-3.5 rounded-full border border-white/20 hover:ring-1 hover:ring-foreground/30"
                                        style={{ backgroundColor: c }}
                                        onClick={() => { setSectionColor(contextMenu.section.id, c); setContextMenu({ kind: "none" }); }}
                                        aria-label={`Set color ${c}`}
                                    />
                                ))}
                            </div>
                            <div className="my-0.5 border-t border-border/50" />
                            <button
                                className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:pointer-events-none"
                                disabled={sections.indexOf(contextMenu.section) === 0}
                                onClick={() => { reorderSection(contextMenu.section.id, "left"); setContextMenu({ kind: "none" }); }}
                            >
                                Move Left
                            </button>
                            <button
                                className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:pointer-events-none"
                                disabled={sections.indexOf(contextMenu.section) === sections.length - 1}
                                onClick={() => { reorderSection(contextMenu.section.id, "right"); setContextMenu({ kind: "none" }); }}
                            >
                                Move Right
                            </button>
                            <div className="my-0.5 border-t border-border/50" />
                            <button
                                className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                                onClick={handleDeleteSection}
                            >
                                Delete
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
