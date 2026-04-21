class Foo { constructor(public a: string) {} }; type DependencyKey<TValue> = (new (...args: never[]) => TValue) | symbol | string; const k: DependencyKey<Foo> = Foo;
