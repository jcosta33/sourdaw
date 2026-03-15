import type { AppAction } from "./AppAction";

export type UndoEntry = {
    id: string;
    label: string;
    action: AppAction;
    inverseAction: AppAction | null;
    timestamp: number;
    source: "manual" | "prompt" | "voice" | "ai";
};

let nextUndoId = 1;

export const createUndoEntry = (
    label: string,
    action: AppAction,
    inverseAction: AppAction | null,
    source: UndoEntry["source"] = "manual",
): UndoEntry => ({
    id: `undo-${nextUndoId++}`,
    label,
    action,
    inverseAction,
    timestamp: Date.now(),
    source,
});
