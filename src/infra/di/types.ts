export type DependencyKey<T> = (new (...args: any[]) => T) | symbol | string | Function;

export type ContainerApi = {
    register<T>(token: DependencyKey<T>, value: T): void;
    set<T>(token: DependencyKey<T>, value: T): void;
    get<T>(token: DependencyKey<T>): T;
    clear(): void;
};