#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEPENDENCY_LICENSE_PROOFS_PATH } from './dependencyLicenseReport.ts';
import { resolvePrimaryRoot, spawnCapture } from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import {
    assertRevisionPresent,
    manifestVersionAtRevision,
    mergedPullRequestsInRange,
    releaseTagNames,
} from './releaseHistory.ts';
import {
    CHANGELOG_PATH,
    RELEASE_INVENTORY_PATH,
    aggregateIncrement,
    compareSemanticVersions,
    composeChangelogEntry,
    formatSemanticVersion,
    latestReleaseTagOf,
    nextVersion,
    parseReleaseTagName,
    parseSemanticVersion,
    releaseCommitSubject,
    releaseTagName,
    upsertChangelogEntry,
    withPackageVersion,
    withPathAddressedDigest,
    withSnapshotDigest,
    type MergedPullRequest,
    type ReleaseIncrement,
    type SemanticVersion,
} from './releaseVersion.ts';

export const RELEASE_BASE_REVISION = 'refs/remotes/origin/main';

/**
 * The release gates pin digests in a chain, so a bump that moves `package.json` and nothing else
 * lands a release pull request they refuse. The dependency-license proofs pin the manifest, and the
 * inventory pins both the manifest and the proofs — so the proofs are rewritten first and the
 * inventory records the digest that rewrite produced. Nothing pins the inventory, which is what
 * ends the chain.
 */
function rewritePinnedDigests(manifest: string, port: ProposeReleasePort): void {
    const manifestDigest = port.digest(manifest);
    const proofs = withSnapshotDigest(
        port.readWorkspaceFile(DEPENDENCY_LICENSE_PROOFS_PATH),
        'package.json',
        manifestDigest
    );
    port.writeWorkspaceFile(DEPENDENCY_LICENSE_PROOFS_PATH, proofs);
    port.writeWorkspaceFile(
        RELEASE_INVENTORY_PATH,
        withPathAddressedDigest(
            withSnapshotDigest(port.readWorkspaceFile(RELEASE_INVENTORY_PATH), 'package.json', manifestDigest),
            DEPENDENCY_LICENSE_PROOFS_PATH,
            port.digest(proofs)
        )
    );
}

export type ProposeReleasePort = {
    releaseTags: () => string[];
    versionAtBase: () => string;
    mergedPullRequests: (previousTag: string | undefined) => MergedPullRequest[];
    readWorkspaceFile: (path: string) => string;
    writeWorkspaceFile: (path: string, contents: string) => void;
    digest: (contents: string) => string;
    today: () => string;
    log: (message: string) => void;
};

export type ReleaseProposal = {
    version: string;
    tag: string;
    increment: ReleaseIncrement;
    commitSubject: string;
};

const usage = 'usage: pnpm release:propose';

/**
 * The version the next release starts from. A cut release leaves the tag and `main`'s manifest
 * agreeing, so a disagreement means one of the two was written by hand and the arithmetic below
 * would silently build on the wrong number.
 */
function baseVersion(port: ProposeReleasePort, previousTag: string | undefined): SemanticVersion {
    const manifestVersion = parseSemanticVersion(port.versionAtBase(), 'package.json version on the release base');
    if (previousTag === undefined) {
        return manifestVersion;
    }
    const tagged = parseReleaseTagName(previousTag);
    if (tagged === undefined) {
        fail(`latest release tag ${previousTag} is not a vX.Y.Z tag`);
    }
    if (compareSemanticVersions(tagged, manifestVersion) !== 0) {
        fail(
            `package.json on the release base is ${formatSemanticVersion(manifestVersion)} but the latest release tag is ${previousTag}`
        );
    }
    return tagged;
}

/**
 * Rewrites the release pull request's whole payload from the base revision every time it runs, so a
 * second proposal in the same lane converges rather than stacking a second entry or a second bump.
 */
export function proposeRelease(port: ProposeReleasePort): ReleaseProposal | undefined {
    const releaseTags = port.releaseTags();
    const previousTag = latestReleaseTagOf(releaseTags);
    const base = baseVersion(port, previousTag);
    const pullRequests = port.mergedPullRequests(previousTag);
    const increment = aggregateIncrement(pullRequests);
    const version = nextVersion(base, increment);
    if (version === undefined) {
        port.log(
            `no-release-proposed: nothing merged since ${previousTag ?? 'the start of history'} requires a version`
        );
        return undefined;
    }
    const manifest = withPackageVersion(port.readWorkspaceFile('package.json'), version);
    port.writeWorkspaceFile('package.json', manifest);
    port.writeWorkspaceFile(
        CHANGELOG_PATH,
        upsertChangelogEntry(
            port.readWorkspaceFile(CHANGELOG_PATH),
            version,
            composeChangelogEntry(version, port.today(), pullRequests),
            releaseTags
        )
    );
    rewritePinnedDigests(manifest, port);
    const formatted = formatSemanticVersion(version);
    const proposal = {
        version: formatted,
        tag: releaseTagName(version),
        increment,
        commitSubject: releaseCommitSubject(formatted),
    };
    logProposal(proposal, port);
    return proposal;
}

function logProposal(proposal: ReleaseProposal, port: ProposeReleasePort): void {
    port.log(`Commit this lane with: git commit -am ${JSON.stringify(proposal.commitSubject)}`);
    port.log('Then open the release pull request with pnpm lane:publish from the primary checkout.');
    port.log(`release-proposed:${proposal.tag}`);
}

function laneRoot(): string {
    const root = spawnCapture('git', ['rev-parse', '--show-toplevel']).trim();
    if (root === resolvePrimaryRoot()) {
        fail('run release:propose from a lane worktree; the primary checkout holds no branch of its own');
    }
    return root;
}

export function shellPort(root: string): ProposeReleasePort {
    const git = (args: string[]) => spawnCapture('git', args, { cwd: root });
    const gh = (args: string[]) => spawnCapture('gh', args, { cwd: root });
    return {
        releaseTags: () => releaseTagNames(gh),
        versionAtBase: () => manifestVersionAtRevision(RELEASE_BASE_REVISION, git),
        mergedPullRequests: (previousTag) => mergedPullRequestsInRange(previousTag, RELEASE_BASE_REVISION, git, gh),
        readWorkspaceFile: (path) => readFileSync(join(root, path), 'utf8'),
        writeWorkspaceFile: (path, contents) => {
            writeFileSync(join(root, path), contents, 'utf8');
        },
        digest: (contents) => createHash('sha256').update(contents, 'utf8').digest('hex'),
        today: () => new Date().toISOString().slice(0, 'YYYY-MM-DD'.length),
        log: (message) => {
            console.log(message);
        },
    };
}

function main(args: string[]): number {
    if (args[0] === '--help') {
        console.log(`Usage: ${usage.slice('usage: '.length)}`);
        return 0;
    }
    if (args.length > 0) {
        fail(usage);
    }
    const root = laneRoot();
    assertRevisionPresent(RELEASE_BASE_REVISION, (gitArgs) => spawnCapture('git', gitArgs, { cwd: root }));
    proposeRelease(shellPort(root));
    return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        process.exit(main(process.argv.slice(2)));
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
