import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { changedReviewPaths, summarizeReviewDiff } from '../reviewDiffSummary.ts';

function fixtureRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'review-diff-summary-'));
    mkdirSync(join(root, 'public', 'legal'), { recursive: true });
    writeFileSync(join(root, '.gitattributes'), 'public/legal/DEPENDENCY-LICENSES.txt linguist-generated=true\n');
    return root;
}

describe('summarizeReviewDiff', () => {
    it('groups every NUL-delimited numstat entry and preserves renamed paths containing tabs and newlines', () => {
        const root = fixtureRoot();
        const numstat = Buffer.from(
            [
                '4\t1\tsrc/app.ts',
                '2\t2\tscripts/__tests__/tool.spec.ts',
                '1\t0\tdocs/guide.md',
                '9\t3\tpnpm-lock.yaml',
                '-\t-\tpublic/wasm/daw-dsp/daw_dsp_bg.wasm',
                '5\t7\t',
                'src/old\tname.ts',
                'src/new\nname.ts',
                '',
            ].join('\0')
        );

        expect(summarizeReviewDiff(root, numstat)).toEqual({
            files: 6,
            added: 21,
            deleted: 13,
            binaryFiles: 1,
            groups: {
                handwritten: { files: 2, added: 9, deleted: 8, binaryFiles: 0 },
                tests: { files: 1, added: 2, deleted: 2, binaryFiles: 0 },
                docs: { files: 1, added: 1, deleted: 0, binaryFiles: 0 },
                generated: { files: 2, added: 9, deleted: 3, binaryFiles: 1 },
            },
        });
    });

    it('uses the destination of a rename for classification and treats unknown paths as handwritten', () => {
        const root = fixtureRoot();
        const numstat = Buffer.from(
            ['3\t4\t', 'src/legacy.ts', 'src/__tests__/renamed.spec.ts', '8\t1\tmystery/output.bin', ''].join('\0')
        );

        const summary = summarizeReviewDiff(root, numstat);

        expect(summary.groups.tests).toEqual({ files: 1, added: 3, deleted: 4, binaryFiles: 0 });
        expect(summary.groups.handwritten).toEqual({ files: 1, added: 8, deleted: 1, binaryFiles: 0 });
        expect(summary.files).toBe(2);
        expect(summary.added).toBe(11);
        expect(summary.deleted).toBe(5);
    });

    it('recognizes repository attributes and committed wasm manifest paths as generated', () => {
        const root = fixtureRoot();
        const numstat = Buffer.from(
            [
                '6\t0\tpublic/legal/DEPENDENCY-LICENSES.txt',
                '1\t1\tpublic/wasm/manifest.json',
                '2\t3\tsrc/modules/AudioEngine/wasm/daw_dsp.js',
                '',
            ].join('\0')
        );

        expect(summarizeReviewDiff(root, numstat).groups.generated).toEqual({
            files: 3,
            added: 9,
            deleted: 4,
            binaryFiles: 0,
        });
    });
});

describe('changedReviewPaths', () => {
    it('classifies the source and destination of a rename record, counting the file once', () => {
        const root = fixtureRoot();
        const numstat = Buffer.from(['2\t4\t', 'src/components/Meter.tsx', 'src/app/Meter.tsx', ''].join('\0'));

        expect(changedReviewPaths(root, numstat)).toEqual([
            {
                path: 'src/app/Meter.tsx',
                group: 'handwritten',
                added: 2,
                deleted: 4,
                binary: false,
                previous: { path: 'src/components/Meter.tsx', group: 'handwritten' },
            },
        ]);
        // One numstat record is one changed file: widening the classification to the rename's
        // source must not double the size report the summary feeds (#4743).
        expect(summarizeReviewDiff(root, numstat).files).toBe(1);
    });

    it('classifies a rename source by its own group, not the destination’s', () => {
        const root = fixtureRoot();
        const numstat = Buffer.from(['0\t3\t', 'src/modules/relay.ts', 'docs/relay.md', ''].join('\0'));

        expect(changedReviewPaths(root, numstat)).toEqual([
            {
                path: 'docs/relay.md',
                group: 'docs',
                added: 0,
                deleted: 3,
                binary: false,
                previous: { path: 'src/modules/relay.ts', group: 'handwritten' },
            },
        ]);
    });

    it('carries no source on a non-rename record', () => {
        const root = fixtureRoot();
        const numstat = Buffer.from(['1\t1\tsrc/app.ts', ''].join('\0'));

        expect(changedReviewPaths(root, numstat)).toEqual([
            { path: 'src/app.ts', group: 'handwritten', added: 1, deleted: 1, binary: false },
        ]);
    });
});
