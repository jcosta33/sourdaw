/**
 * Which changed paths and which source contents are contract-carrying.
 *
 * Contract-carrying paths are the trusted GitHub-write closure, the contract documents (`AGENTS.md`,
 * `.agents/decisions/`, `.agents/skills/`), and the declared workflow boundary. A collected spec whose
 * content imports a closure member or names a pinned workflow file is contract-carrying too, decided
 * from the same rule by both the scan and verify routes so one withheld reference reads the same
 * whichever route produced it.
 */

import { HEALTH_GATE_WORKFLOW_FILES } from '../healthGateWorkflowContract.ts';
import { snapshotImportSpecifiers, trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';

import { isCollectedSpec } from './rules.ts';

const CONTRACT_PATH_PATTERNS: readonly RegExp[] = [
    /(?:^|\/)AGENTS\.md$/u,
    /(?:^|\/)\.agents\/decisions\//u,
    /(?:^|\/)\.agents\/skills\//u,
];

function isContractPath(path: string): boolean {
    return CONTRACT_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * The trusted GitHub-write dependency closure, whose members execute with a role identity; a change to
 * one can move a privileged transition, so these paths are contract-carrying.
 */
const TRUSTED_CLOSURE_PATHS: ReadonlySet<string> = new Set(Object.values(trustedDependencyGraphs).flat());

/** The repo paths of the workflow files the repository declares as its gate boundary. */
const PINNED_WORKFLOW_PATHS: ReadonlySet<string> = new Set(
    HEALTH_GATE_WORKFLOW_FILES.map((name) => `.github/workflows/${name}`)
);

/** Whether a path is a workflow file under `.github/workflows/` named in the repository's declared inventory. */
function isPinnedWorkflowPath(path: string): boolean {
    return path.startsWith('.github/workflows/') && PINNED_WORKFLOW_PATHS.has(path);
}

/** Whether a path is contract-carrying from its path alone: the closure, the contract documents, or the workflow boundary. */
export function isContractCarryingPath(path: string): boolean {
    return isContractPath(path) || TRUSTED_CLOSURE_PATHS.has(path) || isPinnedWorkflowPath(path);
}

/** The directory of a repo-relative path, including the trailing slash; empty for a top-level file. */
function directoryOf(path: string): string {
    const index = path.lastIndexOf('/');
    return index === -1 ? '' : path.slice(0, index + 1);
}

/**
 * Resolves a relative import/export specifier against the importing file's directory to a repo path,
 * leaving the extension off. The extension is added by `resolvesToClosureMember`, matching how the
 * runtime resolves an extensionless import.
 */
function resolveSpecifier(fromDir: string, specifier: string): string | undefined {
    const segments = fromDir.split('/').filter((segment) => segment !== '' && segment !== '.');
    for (const segment of specifier.split('/')) {
        if (segment === '' || segment === '.') {
            continue;
        }
        if (segment === '..') {
            if (segments.pop() === undefined) {
                return undefined;
            }
            continue;
        }
        segments.push(segment);
    }
    return segments.join('/');
}

/** The TypeScript source extensions the repository resolves for an extensionless import specifier. */
const SOURCE_MODULE_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.mts', '.cts'];

/** The JavaScript extensions the runtime maps onto TypeScript source before resolving an import. */
const JS_TO_TS_EXTENSIONS: ReadonlyMap<string, readonly string[]> = new Map([
    ['.js', ['.ts', '.tsx']],
    ['.mjs', ['.mts']],
    ['.cjs', ['.cts']],
    ['.jsx', ['.tsx']],
]);

/** The specifier base without a `?query` or `#hash` postfix, which the runtime strips before resolving. */
function stripModulePostfix(base: string): string {
    const query = base.indexOf('?');
    const hash = base.indexOf('#');
    const cut = Math.min(query === -1 ? base.length : query, hash === -1 ? base.length : hash);
    return base.slice(0, cut);
}

/** The repo paths a resolved specifier could name, after the runtime's postfix strip and JS-to-TS substitution. */
function closureMemberCandidates(base: string): string[] {
    const stripped = stripModulePostfix(base);
    const candidates = [stripped];
    for (const extension of SOURCE_MODULE_EXTENSIONS) {
        candidates.push(stripped + extension);
    }
    for (const [jsExtension, tsExtensions] of JS_TO_TS_EXTENSIONS) {
        if (stripped.endsWith(jsExtension)) {
            const stem = stripped.slice(0, -jsExtension.length);
            for (const tsExtension of tsExtensions) {
                candidates.push(stem + tsExtension);
            }
        }
    }
    return candidates;
}

/** Whether a resolved specifier path names a trusted closure member, with or without a source extension. */
function resolvesToClosureMember(base: string): boolean {
    return closureMemberCandidates(base).some((candidate) => TRUSTED_CLOSURE_PATHS.has(candidate));
}

/** The relative `import`/`export ... from` specifiers of one source file, in document order. */
function relativeImportSpecifiers(source: string): string[] {
    // Collected by walking syntax, not by regex over raw source: comments and the contents of string
    // and template literals cannot contribute, and a dynamic `import('...')` is a real import. Only the
    // relative specifiers are relevant here, since a closure member is always reached by a relative path.
    return snapshotImportSpecifiers(source).filter((specifier) => specifier.startsWith('.'));
}

/**
 * Whether a collected spec's content imports a trusted closure member or names a pinned workflow file.
 * The workflow pin matches the pinned repo path rather than the bare filename, so prose that merely
 * mentions a workflow name cannot classify a spec.
 */
function isContractCarryingSpecContent(content: string, specPath: string): boolean {
    for (const specifier of relativeImportSpecifiers(content)) {
        const resolved = resolveSpecifier(directoryOf(specPath), specifier);
        if (resolved !== undefined && resolvesToClosureMember(resolved)) {
            return true;
        }
    }
    return HEALTH_GATE_WORKFLOW_FILES.some((name) => content.includes(`.github/workflows/${name}`));
}

/** Whether a path is contract-carrying, decided from the path alone or, for a collected spec, from its content. */
export function isContractCarryingContent(path: string, content: string): boolean {
    return isContractCarryingPath(path) || (isCollectedSpec(path) && isContractCarryingSpecContent(content, path));
}
