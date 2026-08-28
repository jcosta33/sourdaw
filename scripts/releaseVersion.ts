import { fail } from './prContract.ts';

export type SemanticVersion = { major: number; minor: number; patch: number };

/** What one merged pull-request title asks the next version to do. */
export type ReleaseIncrement = 'major' | 'minor' | 'patch' | 'none';

export type MergedPullRequest = { number: number; title: string };

export type ConventionalTitle = {
    type: ConventionalType;
    scope: string | undefined;
    breaking: boolean;
    description: string;
};

/**
 * The conventional types this repository writes, mirroring the set `TITLE_PATTERN` in `prContract`
 * accepts. A type outside this set never contributes an increment and lands under the catch-all
 * notes heading, so an unrecognized title can never quietly raise a version.
 */
export const CONVENTIONAL_TYPES = ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'test'] as const;

export type ConventionalType = (typeof CONVENTIONAL_TYPES)[number];

export const RELEASE_TAG_PREFIX = 'v';
export const CHANGELOG_PATH = 'CHANGELOG.md';
export const RELEASE_INVENTORY_PATH = 'release/open-source-inventory.json';

const SEMANTIC_VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const CONVENTIONAL_TITLE_PATTERN = /^([a-z]+)(?:\(([^()]+)\))?(!?): (.+)$/;
const ISO_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
// The full ECMAScript LineTerminator set, written as escapes: the two separator characters
// render as an invisible trap in most editors.
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/**
 * Where a squash merge records the pull request it came from. `deliver` squash-merges, and GitHub
 * writes the pull-request number at the end of the resulting subject, so the trailing group is the
 * only reliable reference. A `(#N)` earlier in a subject is prose, not a merge record.
 */
const SQUASHED_PULL_REQUEST_PATTERN = /\(#([1-9][0-9]*)\)$/;

export function parseSemanticVersion(value: string, label: string): SemanticVersion {
    const match = SEMANTIC_VERSION_PATTERN.exec(value);
    if (match === null) {
        fail(`${label} is not a plain X.Y.Z semantic version: ${value}`);
    }
    return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function formatSemanticVersion(version: SemanticVersion): string {
    return `${String(version.major)}.${String(version.minor)}.${String(version.patch)}`;
}

export function releaseTagName(version: SemanticVersion): string {
    return `${RELEASE_TAG_PREFIX}${formatSemanticVersion(version)}`;
}

export function parseReleaseTagName(tag: string): SemanticVersion | undefined {
    if (!tag.startsWith(RELEASE_TAG_PREFIX)) {
        return undefined;
    }
    const remainder = tag.slice(RELEASE_TAG_PREFIX.length);
    return SEMANTIC_VERSION_PATTERN.test(remainder) ? parseSemanticVersion(remainder, 'release tag') : undefined;
}

export function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
    return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/** The highest `vX.Y.Z` tag in a set, ignoring every tag that is not one. */
export function latestReleaseTagOf(tags: readonly string[]): string | undefined {
    const versions = tags.flatMap((tag) => {
        const version = parseReleaseTagName(tag);
        return version === undefined ? [] : [{ tag, version }];
    });
    return versions.sort((left, right) => compareSemanticVersions(left.version, right.version)).at(-1)?.tag;
}

function isConventionalType(value: string): value is ConventionalType {
    return (CONVENTIONAL_TYPES as readonly string[]).includes(value);
}

export function parseConventionalTitle(title: string): ConventionalTitle | undefined {
    const match = CONVENTIONAL_TITLE_PATTERN.exec(title);
    if (match === null) {
        return undefined;
    }
    const [, type, scope, breakingMark, description] = match;
    if (type === undefined || description === undefined || !isConventionalType(type)) {
        return undefined;
    }
    return { type, scope, breaking: breakingMark === '!', description };
}

/**
 * `!` on the type is the whole breaking signal. A `BREAKING CHANGE` footer lives in a commit body,
 * and the notes source is the pull-request title, so a footer can never reach this decision.
 */
export function titleIncrement(title: string): ReleaseIncrement {
    const parsed = parseConventionalTitle(title);
    if (parsed === undefined) {
        return 'none';
    }
    if (parsed.breaking) {
        return 'major';
    }
    if (parsed.type === 'feat') {
        return 'minor';
    }
    return parsed.type === 'fix' || parsed.type === 'perf' ? 'patch' : 'none';
}

const INCREMENT_RANK: Record<ReleaseIncrement, number> = { none: 0, patch: 1, minor: 2, major: 3 };

export function aggregateIncrement(pullRequests: readonly MergedPullRequest[]): ReleaseIncrement {
    return pullRequests.reduce<ReleaseIncrement>((strongest, pullRequest) => {
        const increment = titleIncrement(pullRequest.title);
        return INCREMENT_RANK[increment] > INCREMENT_RANK[strongest] ? increment : strongest;
    }, 'none');
}

/**
 * Pre-1.0 the leading zero already says the public surface may change, so a breaking change and a
 * feature are both "notable" and both take the minor position; only a fix or a performance change
 * takes the patch position. Crossing to 1.0.0 declares a stable product surface, which is an owner
 * decision rather than an arithmetic consequence of a title, so a zero-major line never leaves its
 * major behind here: the operator edits `package.json` for that release deliberately.
 */
export function nextVersion(base: SemanticVersion, increment: ReleaseIncrement): SemanticVersion | undefined {
    if (increment === 'none') {
        return undefined;
    }
    if (base.major === 0) {
        return increment === 'patch'
            ? { major: 0, minor: base.minor, patch: base.patch + 1 }
            : { major: 0, minor: base.minor + 1, patch: 0 };
    }
    if (increment === 'major') {
        return { major: base.major + 1, minor: 0, patch: 0 };
    }
    if (increment === 'minor') {
        return { major: base.major, minor: base.minor + 1, patch: 0 };
    }
    return { major: base.major, minor: base.minor, patch: base.patch + 1 };
}

/** The notes headings, in the order they are written. Every entry lands under exactly one. */
const NOTE_SECTIONS = [
    { heading: 'Breaking changes', accepts: (title: ConventionalTitle | undefined) => title?.breaking === true },
    { heading: 'Features', accepts: (title: ConventionalTitle | undefined) => title?.type === 'feat' },
    { heading: 'Fixes', accepts: (title: ConventionalTitle | undefined) => title?.type === 'fix' },
    { heading: 'Performance', accepts: (title: ConventionalTitle | undefined) => title?.type === 'perf' },
    { heading: 'Other changes', accepts: () => true },
] as const;

function sectionHeadingFor(title: string): string {
    const parsed = parseConventionalTitle(title);
    const section = NOTE_SECTIONS.find((candidate) => candidate.accepts(parsed));
    return section === undefined ? 'Other changes' : section.heading;
}

function assertNotableTitles(pullRequests: readonly MergedPullRequest[]): void {
    const seen = new Set<number>();
    for (const pullRequest of pullRequests) {
        if (!Number.isSafeInteger(pullRequest.number) || pullRequest.number <= 0) {
            fail('release notes entry must carry a positive pull-request number');
        }
        if (seen.has(pullRequest.number)) {
            fail(`release notes repeat pull request #${String(pullRequest.number)}`);
        }
        seen.add(pullRequest.number);
        if (pullRequest.title.trim() === '') {
            fail(`pull request #${String(pullRequest.number)} has an empty title`);
        }
        if (LINE_TERMINATOR.test(pullRequest.title)) {
            fail(`pull request #${String(pullRequest.number)} title must be one line`);
        }
    }
}

/**
 * Titles pass through exactly as GitHub holds them. The notes are a record of what was merged, and
 * rewriting a title here would make the release disagree with the pull request it names.
 */
export function composeReleaseNotes(pullRequests: readonly MergedPullRequest[]): string {
    assertNotableTitles(pullRequests);
    if (pullRequests.length === 0) {
        fail('release notes need at least one merged pull request');
    }
    const ordered = [...pullRequests].sort((left, right) => left.number - right.number);
    const sections = NOTE_SECTIONS.flatMap((section) => {
        const entries = ordered.filter((pullRequest) => sectionHeadingFor(pullRequest.title) === section.heading);
        return entries.length === 0
            ? []
            : [
                  `### ${section.heading}\n\n${entries
                      .map((entry) => `- ${entry.title} (#${String(entry.number)})`)
                      .join('\n')}`,
              ];
    });
    return sections.join('\n\n');
}

/**
 * GitHub refuses a release body longer than this. The changelog has no such ceiling, so a range too
 * long to publish whole still records every entry — the body carries as many as fit and points at
 * the committed changelog for the rest. A first release that covers a long unreleased history is
 * the case this exists for.
 */
export const RELEASE_BODY_CHARACTER_LIMIT = 125_000;

function releaseBodyPointer(tag: string): string {
    return `\n\nGitHub caps a release body, so the entries above stop short of the full range. ${CHANGELOG_PATH} at ${tag} carries every entry.`;
}

/** The notes as GitHub can hold them: unchanged when they fit, cut at an entry boundary when not. */
export function releaseBody(notes: string, tag: string): string {
    if (notes.length <= RELEASE_BODY_CHARACTER_LIMIT) {
        return notes;
    }
    const pointer = releaseBodyPointer(tag);
    const budget = RELEASE_BODY_CHARACTER_LIMIT - pointer.length;
    let kept = '';
    for (const line of notes.split('\n')) {
        const candidate = kept === '' ? line : `${kept}\n${line}`;
        if (candidate.length > budget) {
            break;
        }
        kept = candidate;
    }
    if (kept.trim() === '') {
        fail('release notes cannot be cut down to a publishable body');
    }
    return `${kept.trimEnd()}${pointer}`;
}

export const CHANGELOG_PREAMBLE = `# Changelog

Every entry below is derived from the titles of the pull requests merged into \`main\` within that
version's tag range. \`pnpm release:propose\` writes the entry and the version bump into a release
pull request; \`pnpm release:cut\` tags the merged revision and publishes the same notes as a GitHub
Release.
`;

export function composeChangelogEntry(
    version: SemanticVersion,
    date: string,
    pullRequests: readonly MergedPullRequest[]
): string {
    if (!ISO_DATE_PATTERN.test(date)) {
        fail(`changelog date is not YYYY-MM-DD: ${date}`);
    }
    return `## ${releaseTagName(version)} - ${date}\n\n${composeReleaseNotes(pullRequests)}\n`;
}

function changelogSectionStart(changelog: string, version: SemanticVersion): number {
    const heading = `## ${releaseTagName(version)} `;
    if (changelog.startsWith(heading)) {
        return 0;
    }
    const index = changelog.indexOf(`\n${heading}`);
    return index < 0 ? -1 : index + 1;
}

function nextSectionStart(changelog: string, from: number): number {
    const index = changelog.indexOf('\n## ', from);
    return index < 0 ? changelog.length : index + 1;
}

/** The notes body recorded for one version, without its dated heading. */
export function changelogSectionBody(changelog: string, version: SemanticVersion): string | undefined {
    const start = changelogSectionStart(changelog, version);
    if (start < 0) {
        return undefined;
    }
    const headingEnd = changelog.indexOf('\n', start);
    if (headingEnd < 0) {
        return undefined;
    }
    return changelog.slice(headingEnd + 1, nextSectionStart(changelog, headingEnd)).trim();
}

type ChangelogSection = { version: SemanticVersion; text: string };

function sectionStartOffsets(body: string): number[] {
    const offsets = [0];
    for (let index = body.indexOf('\n## '); index >= 0; index = body.indexOf('\n## ', index + 1)) {
        offsets.push(index + 1);
    }
    return offsets;
}

function changelogSections(body: string): ChangelogSection[] {
    if (body === '') {
        return [];
    }
    if (!body.startsWith('## ')) {
        fail(`${CHANGELOG_PATH} content does not start with a version section`);
    }
    const offsets = sectionStartOffsets(body);
    return offsets.map((start, position) => {
        const text = body.slice(start, offsets[position + 1] ?? body.length);
        const headingEnd = text.includes('\n') ? text.indexOf('\n') : text.length;
        const heading = text.slice(0, headingEnd);
        const version = parseReleaseTagName(/^## (\S+)/.exec(heading)?.[1] ?? '');
        if (version === undefined) {
            fail(`${CHANGELOG_PATH} carries a section that is not a version section: ${heading}`);
        }
        return { version, text };
    });
}

/**
 * Rebuilds the unreleased head of the changelog around this entry. Every section above the newest
 * released one is a proposal that never became a release, so it is dropped rather than kept: a
 * second proposal computes a different version whenever `main` moved under the lane, and keeping
 * the first would record a version nothing was ever tagged at, with its pull requests listed twice.
 * A released section is a fact and is never touched.
 */
export function upsertChangelogEntry(
    changelog: string,
    version: SemanticVersion,
    entry: string,
    releasedTags: readonly string[]
): string {
    if (!changelog.startsWith(CHANGELOG_PREAMBLE)) {
        fail(`${CHANGELOG_PATH} does not start with the changelog preamble`);
    }
    const released = new Set(releasedTags);
    if (released.has(releaseTagName(version))) {
        fail(`${releaseTagName(version)} is already released; it cannot be proposed again`);
    }
    const sections = changelogSections(changelog.slice(CHANGELOG_PREAMBLE.length).trim());
    const firstReleased = sections.findIndex((section) => released.has(releaseTagName(section.version)));
    const remainder = (firstReleased < 0 ? [] : sections.slice(firstReleased))
        .map((section) => section.text.trim())
        .join('\n\n');
    return `${CHANGELOG_PREAMBLE}\n${entry}${remainder === '' ? '' : `\n${remainder}\n`}`;
}

export function releaseCommitSubject(version: string): string {
    return `chore(release): ${version}`;
}

/**
 * Drops one pull request by identity. Cut uses it on the release pull request whose merge is the
 * revision being tagged: the proposal that wrote the changelog could not have contained it, because
 * it is the commit that proposal became.
 *
 * Identity is the whole point, and a title match is not identity. A recovery release re-proposes
 * the same version, so a range can hold an earlier `chore(release)` merge carrying exactly the same
 * subject — one propose kept as an ordinary entry. Matching on the subject would drop that one too
 * and leave the notes permanently short of the changelog.
 */
export function withoutPullRequest(pullRequests: readonly MergedPullRequest[], number: number): MergedPullRequest[] {
    return pullRequests.filter((pullRequest) => pullRequest.number !== number);
}

const PACKAGE_VERSION_FIELD_PATTERN = /^(\s*"version": ")(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)("(?:,?)$)/m;

export function packageVersion(manifest: string): string {
    const match = PACKAGE_VERSION_FIELD_PATTERN.exec(manifest);
    if (match === null) {
        fail('package.json does not carry a plain X.Y.Z version field');
    }
    return `${match[2] ?? ''}.${match[3] ?? ''}.${match[4] ?? ''}`;
}

/**
 * Rewrites only the version field's digits, leaving every other byte of the manifest alone: a
 * parse-and-restringify round trip would reformat a file the formatter gate owns.
 */
export function withPackageVersion(manifest: string, version: SemanticVersion): string {
    const match = PACKAGE_VERSION_FIELD_PATTERN.exec(manifest);
    if (match === null) {
        fail('package.json does not carry a plain X.Y.Z version field');
    }
    const rest = manifest.slice(match.index + match[0].length);
    if (PACKAGE_VERSION_FIELD_PATTERN.test(rest)) {
        fail('package.json carries more than one version field');
    }
    return `${manifest.slice(0, match.index)}${match[1] ?? ''}${formatSemanticVersion(version)}${match[5] ?? ''}${rest}`;
}

/**
 * The release inventory pins a digest of `package.json`, so a version bump that leaves it alone
 * lands a release pull request the inventory gate refuses. Only the one recorded digest moves.
 */
export function withSnapshotDigest(inventory: string, path: string, sha256: string): string {
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
        fail(`snapshot digest for ${path} is not a SHA-256 digest`);
    }
    const marker = `"path": ${JSON.stringify(path)},`;
    const markerIndex = inventory.indexOf(marker);
    if (markerIndex < 0 || inventory.includes(marker, markerIndex + marker.length)) {
        fail(`release inventory does not carry exactly one ${path} snapshot`);
    }
    const digestPattern = /\n(\s*)"sha256": "[0-9a-f]{64}"/y;
    digestPattern.lastIndex = markerIndex + marker.length;
    const match = digestPattern.exec(inventory);
    if (match === null) {
        fail(`release inventory ${path} snapshot does not carry a digest`);
    }
    return `${inventory.slice(0, markerIndex + marker.length)}\n${match[1] ?? ''}"sha256": "${sha256}"${inventory.slice(digestPattern.lastIndex)}`;
}

function escapedForPattern(value: string): string {
    return value.replaceAll(/[.*+?^${}()|[\]\\/]/g, String.raw`\$&`);
}

/**
 * The other shape a digest is pinned in: one surface addresses a file by `sha256:<digest>:<path>`
 * rather than by a snapshot entry. Rewriting one file the release gates pin therefore moves the
 * digest recorded for it here too.
 */
export function withPathAddressedDigest(inventory: string, path: string, sha256: string): string {
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
        fail(`path-addressed digest for ${path} is not a SHA-256 digest`);
    }
    const pattern = new RegExp(`sha256:[0-9a-f]{64}:${escapedForPattern(path)}`, 'g');
    if ((inventory.match(pattern) ?? []).length !== 1) {
        fail(`release inventory does not carry exactly one path-addressed digest for ${path}`);
    }
    return inventory.replace(pattern, `sha256:${sha256}:${path}`);
}

/**
 * The pull requests a range of squash subjects names, in ascending order. A subject without a
 * trailing merge reference contributed no pull request and is dropped rather than guessed at.
 */
export function squashedPullRequestNumbers(subjects: readonly string[]): number[] {
    const numbers = subjects.flatMap((subject) => {
        const captured = SQUASHED_PULL_REQUEST_PATTERN.exec(subject.trim())?.[1];
        if (captured === undefined) {
            return [];
        }
        const number = Number(captured);
        return Number.isSafeInteger(number) && number > 0 ? [number] : [];
    });
    return [...new Set(numbers)].sort((left, right) => left - right);
}
