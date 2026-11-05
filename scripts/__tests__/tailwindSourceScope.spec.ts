import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Pull-request planning keeps scripts, docs and tool configuration off the browser suite because
// none of them reaches the bundle. Tailwind's automatic source detection would scan them all for
// class names, so the stylesheet must name the app's sources explicitly.
const stylesheet = readFileSync(join(process.cwd(), 'src/styles/main.css'), 'utf8');

describe('Tailwind class-name sources', () => {
    it('scans src through an explicit base instead of automatic detection', () => {
        const imports = Array.from(stylesheet.matchAll(/^@import\s+'tailwindcss'(.*);$/gm), (match) =>
            match[1]?.trim()
        );
        expect(imports).toEqual(["source('../')"]);
    });

    it('adds only the HTML entry as an extra source', () => {
        const sources = Array.from(stylesheet.matchAll(/^@source\s+(.+);$/gm), (match) => match[1]?.trim());
        expect(sources).toEqual(["'../../index.html'"]);
    });
});
