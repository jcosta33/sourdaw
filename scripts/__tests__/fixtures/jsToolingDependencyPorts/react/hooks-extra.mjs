import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Linter } from 'eslint';
import hooks from 'eslint-plugin-react-hooks';
const req = createRequire(import.meta.url),
    hreq = createRequire(req.resolve('eslint-plugin-react-hooks/package.json'));
const hermes = hreq('hermes-parser');
let ast = hermes.parse('const value = input?.nested ?? 0; export function View(){return <div>{value}</div>}', {
    babel: true,
    sourceType: 'module',
});
assert.equal(ast.type, 'File');
assert.throws(
    () => hermes.parse('export function View(){ return <div> }', { babel: true, sourceType: 'module' }),
    SyntaxError
);
console.log('PASS real Hermes modern AST and invalid JSX rejected');
const preset = hooks.configs.flat['recommended-latest'];
let messages = new Linter().verify(
    "import {useState} from 'react'; export function View(){const [value,setValue]=useState(0);setValue(value+1);return <div>{value}</div>}",
    [
        { ...preset, files: ['**/*.jsx'] },
        {
            files: ['**/*.jsx'],
            languageOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                parserOptions: { ecmaFeatures: { jsx: true } },
            },
            rules: {
                'react-hooks/incompatible-library': 'error',
                'react-hooks/unsupported-syntax': 'error',
                'react-hooks/refs': 'warn',
                'react-hooks/purity': 'warn',
                'react-hooks/set-state-in-effect': 'warn',
            },
        },
    ],
    { filename: 'fixture.jsx' }
);
console.log(JSON.stringify(messages));
assert(messages.some((m) => m.ruleId === 'react-hooks/set-state-in-render' && m.severity === 2));
console.log('PASS configured compiler catches unconditional render state update');
