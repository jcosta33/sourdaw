const original = WebAssembly.Module;
WebAssembly.Module = class extends original {
    constructor(...args) {
        throw new Error('lexer WASM initialization sentinel');
    }
};
