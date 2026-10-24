import { execFileSync } from 'node:child_process';

function git(root: string, args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

/** Compare the checked-out PR integration with its first parent, excluding concurrent base changes. */
export function readCheckoutDiff(
    root: string,
    eventBase: string,
    candidateHead: string
): {
    checkout: string;
    firstParent: string;
    diff: string;
} {
    const checkout = git(root, ['rev-parse', 'HEAD']).trim();
    let firstParent = eventBase;
    let revisions = [`${eventBase}...${candidateHead}`];
    if (checkout !== candidateHead) {
        const parents = git(root, ['rev-list', '--parents', '-n', '1', checkout]).trim().split(' ');
        if (parents.length !== 3 || parents[0] !== checkout || parents[2] !== candidateHead) {
            throw new Error('Integration commit is not a two-parent merge of the candidate head');
        }
        firstParent = parents[1]!;
        if (git(root, ['merge-base', eventBase, firstParent]).trim() !== eventBase) {
            throw new Error('Integration first parent does not descend from the event base');
        }
        revisions = [firstParent, checkout];
    }
    if (checkout !== candidateHead) {
        if (git(root, ['status', '--porcelain', '--untracked-files=no']) !== '') {
            throw new Error('Selection checkout has dirty tracked inputs');
        }
        if (
            git(root, [
                'status',
                '--porcelain',
                '--untracked-files=all',
                '--',
                'src',
                'public',
                'tests/e2e',
                'scripts/e2eSuiteOwners.json',
                'scripts/e2eAffectedGraph.ts',
                'tsconfig.json',
                'playwright.config.ts',
                'package.json',
            ]) !== ''
        ) {
            throw new Error('Selection checkout has uncommitted inventory or graph inputs');
        }
    }
    return {
        checkout,
        firstParent,
        diff: git(root, ['diff', '--name-status', '-z', '--find-renames', ...revisions, '--']),
    };
}
