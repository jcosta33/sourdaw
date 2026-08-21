import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('package scripts and gitignore', () => {
    it('defines the trusted pnpm commands as direct node invocations', () => {
        const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };
        expect(pkg.scripts['lane:open']).toBe('node scripts/openLane.ts');
        expect(pkg.scripts['lane:publish']).toBe('node scripts/publishLane.ts');
        expect(pkg.scripts['review:prepare']).toBe('node scripts/prepareReview.ts');
        expect(pkg.scripts['review:publish']).toBe('node scripts/publishReview.ts');
        expect(pkg.scripts['review:resolve']).toBe('node scripts/resolveReviewThread.ts');
        expect(pkg.scripts['pr:supersede']).toBe('node scripts/supersedePullRequest.ts');
        expect(pkg.scripts['lane:remove']).toBe('node scripts/removeLane.ts');
        expect(pkg.scripts.deliver).toBe('node scripts/deliverPullRequest.ts');
    });

    it('ignores role credential files and review bundles', () => {
        const gitignore = readFileSync(join(import.meta.dirname, '../../.gitignore'), 'utf8');
        expect(gitignore).toContain('.env.*');
        expect(gitignore).toContain('.agents/review-bundles/');
    });

    /**
     * `lane:publish` opens the pull request and `deliver` merges it, and a base the two disagree
     * about is a squash onto a branch nobody reviewed against. Neither may carry its own literal.
     */
    it('opens and merges every pull request against the one trunk constant', () => {
        const identity = readFileSync(join(import.meta.dirname, '../githubAppIdentity.ts'), 'utf8');
        expect(identity).toMatch(/export const REQUIRED_BASE_BRANCH = 'main';/);
        const publish = readFileSync(join(import.meta.dirname, '../publishLane.ts'), 'utf8');
        expect(publish).toMatch(/'--base',\s+REQUIRED_BASE_BRANCH,/);
        const deliver = readFileSync(join(import.meta.dirname, '../deliverPullRequest.ts'), 'utf8');
        expect(deliver).toMatch(/baseRefName !== REQUIRED_BASE_BRANCH/);
    });

    it('does not spawn a language-model CLI from the trusted scripts', () => {
        const files = [
            'openLane.ts',
            'publishLane.ts',
            'prepareReview.ts',
            'publishReview.ts',
            'deliverPullRequest.ts',
            'removeLane.ts',
            'resolveReviewThread.ts',
            'supersedePullRequest.ts',
            'githubAppIdentity.ts',
        ];
        for (const file of files) {
            const source = readFileSync(join(import.meta.dirname, '..', file), 'utf8');
            expect(source).not.toMatch(/spawnSync\(\s*['"]claude/);
            expect(source).not.toMatch(/spawnSync\(\s*['"]codex/);
            expect(source).not.toMatch(/spawnSync\(\s*['"]cursor/);
        }
    });
});
