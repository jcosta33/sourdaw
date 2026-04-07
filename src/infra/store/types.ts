export type Store<TSnapshot> = {
    subscribe(listener: () => void): () => void;
    get(): TSnapshot;
};

export type StoreController<TSnapshot> = {
    set(next: TSnapshot): void;
    update(updater: (prev: TSnapshot) => TSnapshot): void;
};