#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_NODE_ID,
    REQUIRED_BASE_BRANCH,
    REQUIRED_REPOSITORY,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    isAuthorBotNodeId,
    originMainBlob,
    parseJson,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import {
    assertRevisionPresent,
    commitIsOnMainBranch,
    fileAtRevision,
    latestReleaseTag,
    manifestVersionAtRevision,
    mergedPullRequestsInRange,
    releaseTagNames,
    releaseTagNamesWithReleases,
    type CommandReader,
} from './releaseHistory.ts';
import {
    CHANGELOG_PATH,
    changelogSectionBody,
    compareSemanticVersions,
    composeReleaseNotes,
    formatSemanticVersion,
    parseReleaseTagName,
    parseSemanticVersion,
    releaseBody,
    releaseTagName,
    type MergedPullRequest,
    type SemanticVersion,
} from './releaseVersion.ts';

export type ReleaseTagReceipt = { tagObjectSha: string; refSha: string; refName: string };
export type CreatedRelease = { id: number; tagName: string; targetCommitish: string; draft: boolean };

export type CutReleasePort = {
    tagNames: () => string[];
    releasedTagNames: () => string[];
    latestReleaseTag: () => string | undefined;
    commitIsOnMain: (commit: string) => boolean;
    manifestVersionAt: (commit: string) => string;
    changelogAt: (commit: string) => string;
    mergedPullRequests: (previousTag: string | undefined, commit: string) => MergedPullRequest[];
    createTag: (tag: string, commit: string, message: string) => ReleaseTagReceipt;
    createRelease: (tag: string, commit: string, notes: string) => CreatedRelease;
    log: (message: string) => void;
};

export type CutReleaseArgs = { version?: string; commit?: string; help: boolean };

const usage = 'usage: pnpm release:cut <X.Y.Z> --commit <40-hex-sha>';

export function parseCutReleaseArgs(args: string[]): CutReleaseArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const [version, flag, commit] = args;
    if (
        args.length !== 3 ||
        flag !== '--commit' ||
        version === undefined ||
        commit === undefined ||
        !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version) ||
        !/^[0-9a-f]{40}$/.test(commit)
    ) {
        fail(usage);
    }
    return { version, commit, help: false };
}

export function releaseTagMessage(tag: string): string {
    return `Sourdaw ${tag}`;
}

function assertTagIsUnclaimed(tag: string, port: CutReleasePort): void {
    if (port.tagNames().includes(tag)) {
        fail(`tag ${tag} already exists`);
    }
    if (port.releasedTagNames().includes(tag)) {
        fail(`a GitHub Release for ${tag} already exists`);
    }
}

/**
 * The notes and the changelog entry are the same text derived from the same tag range, so a
 * disagreement means the proposal was composed against a different range than the one being tagged
 * — usually a pull request merged after the release pull request was written. Re-proposing is the
 * repair; publishing notes that contradict the committed changelog is not.
 */
function assertChangelogMatchesNotes(
    commit: string,
    version: SemanticVersion,
    notes: string,
    port: CutReleasePort
): void {
    const tag = releaseTagName(version);
    const recorded = changelogSectionBody(port.changelogAt(commit), version);
    if (recorded === undefined) {
        fail(`${CHANGELOG_PATH} at ${commit} records no ${tag} entry`);
    }
    if (recorded !== notes.trim()) {
        fail(`${CHANGELOG_PATH} at ${commit} does not match the notes for the ${tag} range; re-run release:propose`);
    }
}

function assertTagReceipt(receipt: ReleaseTagReceipt, tag: string): void {
    if (
        !/^[0-9a-f]{40}$/.test(receipt.tagObjectSha) ||
        receipt.refSha !== receipt.tagObjectSha ||
        receipt.refName !== `refs/tags/${tag}`
    ) {
        fail(`creating tag ${tag} returned an invalid result`);
    }
}

function assertReleaseReceipt(release: CreatedRelease, tag: string, commit: string): void {
    if (!Number.isSafeInteger(release.id) || release.id <= 0 || release.tagName !== tag) {
        fail(`creating the GitHub Release for ${tag} returned an invalid result`);
    }
    if (release.draft) {
        fail(`the GitHub Release for ${tag} was created as a draft`);
    }
    if (release.targetCommitish !== commit) {
        fail(`the GitHub Release for ${tag} is not bound to ${commit}`);
    }
}

export function cutRelease(version: string, commit: string, authorNodeId: string, port: CutReleasePort): string {
    if (!isAuthorBotNodeId(authorNodeId)) {
        fail(`authenticated author actor ${authorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
    }
    const semantic = parseSemanticVersion(version, 'release version');
    const tag = releaseTagName(semantic);
    assertTagIsUnclaimed(tag, port);
    if (!port.commitIsOnMain(commit)) {
        fail(`${commit} is not on ${REQUIRED_BASE_BRANCH}`);
    }
    const manifestVersion = port.manifestVersionAt(commit);
    if (manifestVersion !== formatSemanticVersion(semantic)) {
        fail(`package.json at ${commit} is ${manifestVersion}, not ${formatSemanticVersion(semantic)}`);
    }
    const previousTag = port.latestReleaseTag();
    assertVersionAdvances(semantic, previousTag);
    const notes = composeReleaseNotes(port.mergedPullRequests(previousTag, commit));
    assertChangelogMatchesNotes(commit, semantic, notes, port);
    assertTagReceipt(port.createTag(tag, commit, releaseTagMessage(tag)), tag);
    assertReleaseReceipt(port.createRelease(tag, commit, releaseBody(notes, tag)), tag, commit);
    const receipt = `release-cut:${tag}:${commit}`;
    port.log(receipt);
    return receipt;
}

function assertVersionAdvances(version: SemanticVersion, previousTag: string | undefined): void {
    if (previousTag === undefined) {
        return;
    }
    const previous = parseReleaseTagName(previousTag);
    if (previous === undefined) {
        fail(`latest release tag ${previousTag} is not a vX.Y.Z tag`);
    }
    if (compareSemanticVersions(version, previous) <= 0) {
        fail(`${releaseTagName(version)} does not advance the latest release tag ${previousTag}`);
    }
}

type GitTagObject = { sha?: unknown };
type GitRefObject = { ref?: unknown; object?: { sha?: unknown } };
type ReleaseObject = { id?: unknown; tag_name?: unknown; target_commitish?: unknown; draft?: unknown };

function createAnnotatedTag(tag: string, commit: string, message: string, gh: CommandReader): ReleaseTagReceipt {
    const tagObject = parseJson<GitTagObject>(
        gh([
            'api',
            '-X',
            'POST',
            `repos/${REQUIRED_REPOSITORY}/git/tags`,
            '-f',
            `tag=${tag}`,
            '-f',
            `message=${message}`,
            '-f',
            `object=${commit}`,
            '-f',
            'type=commit',
        ]),
        `create tag object ${tag}`
    );
    if (typeof tagObject.sha !== 'string') {
        fail(`creating tag ${tag} returned an invalid result`);
    }
    const ref = parseJson<GitRefObject>(
        gh([
            'api',
            '-X',
            'POST',
            `repos/${REQUIRED_REPOSITORY}/git/refs`,
            '-f',
            `ref=refs/tags/${tag}`,
            '-f',
            `sha=${tagObject.sha}`,
        ]),
        `create tag ref ${tag}`
    );
    if (typeof ref.ref !== 'string' || typeof ref.object?.sha !== 'string') {
        fail(`creating tag ${tag} returned an invalid result`);
    }
    return { tagObjectSha: tagObject.sha, refSha: ref.object.sha, refName: ref.ref };
}

function createGithubRelease(tag: string, commit: string, notes: string, gh: CommandReader): CreatedRelease {
    const release = parseJson<ReleaseObject>(
        gh([
            'api',
            '-X',
            'POST',
            `repos/${REQUIRED_REPOSITORY}/releases`,
            '-f',
            `tag_name=${tag}`,
            '-f',
            `target_commitish=${commit}`,
            '-f',
            `name=${tag}`,
            '-f',
            `body=${notes}`,
            '-F',
            'draft=false',
            '-F',
            'prerelease=false',
            '-f',
            'make_latest=true',
        ]),
        `create release ${tag}`
    );
    if (
        typeof release.id !== 'number' ||
        typeof release.tag_name !== 'string' ||
        typeof release.target_commitish !== 'string' ||
        typeof release.draft !== 'boolean'
    ) {
        fail(`creating the GitHub Release for ${tag} returned an invalid result`);
    }
    return {
        id: release.id,
        tagName: release.tag_name,
        targetCommitish: release.target_commitish,
        draft: release.draft,
    };
}

export function shellPort(session: GhSession, primaryRoot: string): CutReleasePort {
    const git: CommandReader = (args) => spawnCapture('git', args, { cwd: primaryRoot });
    const gh: CommandReader = (args) => spawnCapture('gh', args, { cwd: primaryRoot, env: session.env });
    return {
        tagNames: () => releaseTagNames(gh),
        releasedTagNames: () => releaseTagNamesWithReleases(gh),
        latestReleaseTag: () => latestReleaseTag(gh),
        commitIsOnMain: (commit) => commitIsOnMainBranch(commit, gh),
        manifestVersionAt: (commit) => manifestVersionAtRevision(commit, git),
        changelogAt: (commit) => fileAtRevision(commit, CHANGELOG_PATH, git),
        mergedPullRequests: (previousTag, commit) => mergedPullRequestsInRange(previousTag, commit, git, gh),
        createTag: (tag, commit, message) => createAnnotatedTag(tag, commit, message, gh),
        createRelease: (tag, commit, notes) => createGithubRelease(tag, commit, notes, gh),
        log: (message) => {
            console.log(message);
        },
    };
}

async function main(): Promise<number> {
    const parsed = parseCutReleaseArgs(process.argv.slice(2));
    if (parsed.help) {
        console.log(`Usage: ${usage.slice('usage: '.length)}`);
        return 0;
    }
    if (parsed.version === undefined || parsed.commit === undefined) {
        fail(usage);
    }
    const cwd = process.cwd();
    assertTrustedExecutingBlob(
        'scripts/cutRelease.ts',
        fileURLToPath(import.meta.url),
        originMainBlob('scripts/cutRelease.ts', cwd)
    );
    const primaryRoot = resolvePrimaryRoot();
    assertRevisionPresent(parsed.commit, (args) => spawnCapture('git', args, { cwd: primaryRoot }));
    const auth = await authenticateRole({ primaryRoot, role: 'author' });
    try {
        if (!isAuthorBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
        }
        assertRequiredRepository(
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: auth.session.env,
                cwd: primaryRoot,
            })
        );
        cutRelease(parsed.version, parsed.commit, auth.minted.actorNodeId, shellPort(auth.session, primaryRoot));
        return 0;
    } finally {
        auth.session.dispose();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void main().then(
        (code) => process.exit(code),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        }
    );
}
