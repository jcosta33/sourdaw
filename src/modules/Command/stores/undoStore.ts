import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { Store } from "#/helpers/Store/Store";
import type { UndoEntry } from "../models/UndoEntry";

const logger = Container.getInstance().get(Logger);

export type UndoStoreState = {
    past: UndoEntry[];
    future: UndoEntry[];
};

export const undoStore = new Store<UndoStoreState>(logger, {
    initialData: { past: [], future: [] },
});

export const pushUndo = (entry: UndoEntry): void => {
    const state = undoStore.value;
    if (!state) return;
    undoStore.set({
        past: [...state.past, entry],
        future: [],
    });
};
