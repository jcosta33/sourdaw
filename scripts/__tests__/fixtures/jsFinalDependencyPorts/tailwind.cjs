const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    path = require('node:path'),
    { createRequire } = require('node:module');
assert.equal(typeof global.gc, 'function', 'scanner contract requires exposed GC');
const root = path.resolve(process.argv[2]);
const req = createRequire(process.env.TAILWIND_VITE_PACKAGE);
process.env.NAPI_RS_FORCE_WASI = 'error';
const oxidePath = req.resolve('@tailwindcss/oxide');
const oxreq = createRequire(oxidePath);
const wasmPath = oxreq.resolve('@tailwindcss/oxide-wasm32-wasi');
const binding = oxreq('@tailwindcss/oxide-wasm32-wasi');
const oxide = req('@tailwindcss/oxide');
assert.equal(oxide.Scanner, binding.Scanner);
const wr = createRequire(wasmPath);
let versions = {};
for (const name of [
    '@emnapi/core',
    '@emnapi/runtime',
    '@emnapi/wasi-threads',
    '@napi-rs/wasm-runtime',
    '@tybys/wasm-util',
    'tslib',
]) {
    let p = path.join(path.dirname(wasmPath), 'node_modules', name, 'package.json');
    const m = JSON.parse(fs.readFileSync(p));
    versions[name] = { version: m.version, path: fs.realpathSync(p), resolved: fs.realpathSync(wr.resolve(name)) };
    assert.ok(versions[name].resolved.startsWith(path.dirname(p)));
}
const dir = path.join(root, 'fixture');
fs.mkdirSync(path.join(dir, 'ignored'), { recursive: true });
fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored/\n');
fs.writeFileSync(path.join(dir, 'café.html'), '<div class="bg-red-500 p-4 hover:text-blue-600">Hello</div>');
fs.writeFileSync(path.join(dir, 'component.jsx'), 'export default () => <span className="font-bold grid-cols-3"/>');
fs.writeFileSync(path.join(dir, 'ignored', 'no.html'), '<p class="hidden opacity-13">x</p>');
try {
    fs.symlinkSync('café.html', path.join(dir, 'linked.html'));
} catch (e) {
    if (e.code !== 'EEXIST') throw e;
}
const scanner = new oxide.Scanner({
    sources: [
        { base: dir, pattern: '**/*', negated: false },
        { base: dir, pattern: 'ignored/**', negated: true },
    ],
});
let initial = scanner.scan().sort();
for (let x of ['bg-red-500', 'p-4', 'hover:text-blue-600', 'font-bold', 'grid-cols-3'])
    assert.ok(initial.includes(x), x);
assert.ok(!initial.includes('opacity-13'));
let input = [
    { content: '<main class="text-xl ring-2">ok</main>', extension: 'html' },
    { content: 'const x = <div className="md:flex gap-7"/>', extension: 'jsx' },
    { content: '@apply underline decoration-wavy;', extension: 'css' },
    { content: 'prose tracking-wide', extension: 'txt' },
];
let content = scanner.scanFiles(input).sort();
console.error('content', JSON.stringify(content));
for (let x of ['text-xl', 'ring-2', 'md:flex', 'gap-7', 'prose', 'tracking-wide']) assert.ok(content.includes(x), x);
let positions = scanner.getCandidatesWithPositions({ content: '<div class="p-4">x</div>', extension: 'html' });
assert.deepEqual(positions, [
    { candidate: 'class', position: 5 },
    { candidate: 'p-4', position: 12 },
]);
let errors = [];
for (const f of [
    () => scanner.scanFiles([{}]),
    () => scanner.getCandidatesWithPositions({ extension: 'html' }),
    () => scanner.scanFiles([{ file: path.join(dir, 'missing.html'), extension: 'html' }]),
]) {
    try {
        errors.push({ result: f() });
    } catch (e) {
        errors.push({ name: e.name, message: e.message });
    }
}
fs.writeFileSync(path.join(dir, 'café.html'), '<div class="new-token-72"></div>');
let updated = scanner.scanFiles([{ file: path.join(dir, 'café.html'), extension: 'html' }]).sort();
assert.ok(updated.includes('new-token-72'));
let files = scanner.files.map((f) => path.relative(dir, f)).sort(),
    scanned = scanner.scannedFiles.map((f) => path.relative(dir, f)).sort();
let repeated = [];
for (let i = 0; i < 20; i++) {
    let x = new oxide.Scanner({ sources: [] });
    let v = x.scanFiles([{ content: `<b class="iteration-${i}">`, extension: 'html' }]);
    assert.ok(v.includes(`iteration-${i}`));
    repeated.push(v);
    x = null;
    global.gc();
}
console.log(
    JSON.stringify({ versions, initial, content, positions, errors, updated, files, scanned, repeated }, null, 2)
);
