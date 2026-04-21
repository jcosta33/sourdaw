type EventHandler<T> = (payload: T) => void;
let a: EventHandler<string> = (p: string) => {};
let b: EventHandler<never> = a; // Should be allowed
let c: EventHandler<unknown> = a; // Should be error
