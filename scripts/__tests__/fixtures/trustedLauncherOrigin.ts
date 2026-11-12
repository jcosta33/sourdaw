import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { GITHUB_ORIGIN_URL } from '../../trustedGithubWriteBootstrap.ts';

/**
 * The real launcher pins the commit GitHub reports for main, so a fixture that runs it must point its
 * copied launcher at a local bare origin instead. The origin lives inside the fixture's own git
 * directory, so it is never staged and is removed with the fixture.
 */
export function launcherFixtureOrigin(repository: string): string {
    return join(repository, '.git', 'sourdaw-launcher-origin.git');
}

/**
 * Rewrites the launcher's GitHub URL to the fixture origin, and refuses a source that would still
 * reach github.com: a missed rewrite must fail here, not clone the real repository.
 */
export function localLauncherSource(source: string, originPath: string): string {
    const localUrl = pathToFileURL(originPath).href;
    const rewritten = source.replaceAll(GITHUB_ORIGIN_URL, localUrl);
    if (rewritten.includes('github.com') || !rewritten.includes(localUrl)) {
        throw new Error('fixture launcher does not pin a local origin');
    }
    return rewritten;
}

export function writeLocalLauncher(
    bootstrapPath: string,
    originPath: string,
    source = readFileSync(bootstrapPath, 'utf8')
): void {
    writeFileSync(bootstrapPath, localLauncherSource(source, originPath));
}

/** Publishes `revision` as the fixture origin's main, which is what the launcher then pins. */
export function publishLauncherOrigin(
    git: (args: string[]) => unknown,
    originPath: string,
    revision = 'refs/remotes/origin/main'
): void {
    git(['init', '--quiet', '--bare', originPath]);
    git(['push', '--quiet', '--force', originPath, `${revision}:refs/heads/main`]);
}
