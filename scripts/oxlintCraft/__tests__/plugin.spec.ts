import { RuleTester } from 'oxlint/plugins-dev';
import { describe, expect, it } from 'vitest';

import { craftBaselineFiles } from '../../../oxlint.craft-baseline.mjs';
import plugin, { type CraftRuleId, isCraftBaselineFile, relativeFilename } from '../plugin.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
    languageOptions: { parserOptions: { lang: 'ts' } },
});

const rules = plugin.rules;

function runCraftRule(name: CraftRuleId, tests: Parameters<RuleTester['run']>[2]): void {
    const rule = rules[name];
    // oxlint/plugins-dev does not export the Rule type that RuleTester.run requires.
    // @ts-expect-error oxlint plugins-dev keeps Rule internal, so the plugin shape cannot name it
    ruleTester.run(name, rule, tests);
}

describe('sourdaw-craft plugin surface', () => {
    it('should register every craft rule under the plugin name', () => {
        expect(plugin.meta.name).toBe('sourdaw-craft');
        expect(Object.keys(rules).sort()).toEqual([
            'no-conditional-empty-spread',
            'no-control-flow-ternary',
            'no-json-parse-stringify',
            'no-long-array-chain',
            'no-spread-clone-array-method',
            'no-useless-clone-spread',
        ]);
    });

    it('should match listed relative paths and reject unlisted ones', () => {
        expect(relativeFilename('src/example.ts')).toBe('src/example.ts');
        expect(isCraftBaselineFile('src/not-on-any-list.ts', 'no-useless-clone-spread')).toBe(false);
        const listed = craftBaselineFiles['no-useless-clone-spread'];
        const first = listed[0];
        const last = listed[listed.length - 1];
        expect(listed.length).toBeGreaterThan(1);
        expect(first).toBeDefined();
        expect(last).toBeDefined();
        expect(first).not.toBe(last);
        expect(isCraftBaselineFile(first, 'no-useless-clone-spread')).toBe(true);
        expect(isCraftBaselineFile(last, 'no-useless-clone-spread')).toBe(true);
    });
});

runCraftRule('no-conditional-empty-spread', {
    valid: [
        'const next = { ...record, field: true };',
        'fn(...args);',
        'const merged = { ...a, ...b };',
        'const copy = { ...record, ...(extras) };',
        'const list = [...items, extra];',
        {
            filename: 'Panel.tsx',
            code: 'const node = <Panel {...props} />;',
        },
    ],
    invalid: [
        {
            code: 'const props = { ...base, ...(open ? { role: "dialog" } : {}) };',
            errors: [{ message: /Do not spread a conditional or logical expression/ }],
        },
        {
            code: 'const props = { ...base, ...(open && { role: "dialog" }) };',
            errors: [{ message: /Do not spread a conditional or logical expression/ }],
        },
        {
            code: 'fn(...(ready ? extra : []));',
            errors: [{ message: /Do not spread a conditional or logical expression/ }],
        },
        {
            filename: 'Panel.tsx',
            code: 'const node = <Panel {...(open ? { role: "dialog" } : {})} />;',
            errors: [{ message: /Do not spread a conditional or logical expression/ }],
        },
        {
            filename: 'Panel.tsx',
            code: 'const node = <Panel {...(open && { hidden: true })} />;',
            errors: [{ message: /Do not spread a conditional or logical expression/ }],
        },
    ],
});

runCraftRule('no-useless-clone-spread', {
    valid: [
        'const next = { ...record, field: true };',
        'const merged = { ...a, ...b };',
        'const original = record;',
        'fn(...args);',
    ],
    invalid: [
        {
            code: 'const clone = { ...record };',
            errors: [{ message: /Do not clone with `\{ \.\.\.x \}`/ }],
        },
    ],
});

runCraftRule('no-spread-clone-array-method', {
    valid: [
        'const mapped = notes.map(transpose);',
        'const filtered = notes.filter(isOn);',
        'const concatThenMap = [...notes, extra].map(transpose);',
        'const copy = [...notes];',
    ],
    invalid: [
        {
            code: 'const mapped = [...notes].map(transpose);',
            errors: [{ message: /Do not clone with spread before `\.map`/ }],
        },
        {
            code: 'const filtered = [...notes].filter(isOn);',
            errors: [{ message: /Do not clone with spread before `\.filter`/ }],
        },
    ],
});

runCraftRule('no-json-parse-stringify', {
    valid: [
        'const copy = structuredClone(record);',
        'const parsed = JSON.parse(text);',
        'const text = JSON.stringify(record);',
    ],
    invalid: [
        {
            code: 'const clone = JSON.parse(JSON.stringify(record));',
            errors: [{ message: /Do not clone with JSON\.parse\(JSON\.stringify/ }],
        },
    ],
});

runCraftRule('no-long-array-chain', {
    valid: [
        'const names = tracks.filter(isArmed).map(toName);',
        'const joined = tracks.map(toName).join(",");',
        'const sorted = names.sort();',
    ],
    invalid: [
        {
            code: 'const names = tracks.filter(isArmed).map(toName).sort();',
            errors: [{ message: /Do not chain three or more/ }],
        },
        {
            code: 'const total = events.filter(isNote).map(toVelocity).reduce(sum, 0);',
            errors: [{ message: /Do not chain three or more/ }],
        },
    ],
});

runCraftRule('no-control-flow-ternary', {
    valid: [
        "const label = armed ? 'on' : 'off';",
        'const value = cond ? foo() : bar();',
        {
            filename: 'Panel.tsx',
            code: 'const node = open ? <Dialog /> : <Placeholder />;',
        },
        {
            filename: 'Panel.tsx',
            code: 'const view = <Button className={active ? "on" : "off"} />;',
        },
    ],
    invalid: [
        {
            code: 'armed ? arm() : disarm();',
            errors: [{ message: /Do not use a ternary as a statement/ }],
        },
        {
            code: 'const next =\n    ready\n        ? start()\n        : stop();',
            errors: [{ message: /Do not use a ternary as an if/ }],
        },
    ],
});
