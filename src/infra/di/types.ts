export type DependencyKey<TValue> = (new (...args: never[]) => TValue) | symbol | string;

export type ContainerApi = {
    register<TValue>(token: DependencyKey<TValue>, value: TValue): void;
    set<TValue>(token: DependencyKey<TValue>, value: TValue): void;
    get<TValue>(token: DependencyKey<TValue>): TValue;
    clear(): void;
};
