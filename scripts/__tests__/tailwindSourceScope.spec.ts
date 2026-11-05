import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Pull-request planning keeps scripts, docs and tool configuration off the browser suite because
// none of them reaches the bundle. Tailwind's automatic source detection would scan them all for
// class names, so the stylesheets must name the app's sources explicitly, and only main.css may.
const root = process.cwd();
const stylesheets = readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.css'))
    .map((path) => ({ path: `src/${path}`, text: readFileSync(join(root, 'src', path), 'utf8') }));

function directives(pattern: RegExp): string[] {
    return stylesheets.flatMap(({ path, text }) =>
        Array.from(text.matchAll(pattern), (match) => `${path}: ${match[1]?.trim() ?? ''}`)
    );
}

describe('Tailwind class-name sources', () => {
    it('imports Tailwind once, through an explicit base at src/', () => {
        expect(directives(/^\s*@import\s+['"]tailwindcss['"](.*);/gm)).toEqual(["src/styles/main.css: source('../')"]);
    });

    it('adds only the HTML entry as an extra source', () => {
        expect(directives(/^\s*@source\s+(.+);/gm)).toEqual(["src/styles/main.css: '../../index.html'"]);
    });
});
