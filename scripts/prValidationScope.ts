import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SMOKE_SPEC = 'tests/e2e/smoke.spec.ts';

// Only known presentation files have narrow maps. State/audio producers, shared
// shells, hooks and new files fall through to the complete browser suite.
// Keep these file lists explicit: a new UI or browser workflow needs a coverage decision.
const PREFERENCES_SPECS = [
    'tests/e2e/preferencesDialogDeepTestId.spec.ts',
    'tests/e2e/shortcutBehavioralE2E.spec.ts',
    'tests/e2e/browserDisplayScale.spec.ts',
    'tests/e2e/transportResponsive.spec.ts',
    'tests/e2e/pianoRollDockAcceptance.spec.ts',
];
const MIXER_SPECS = [
    'tests/e2e/mixer.spec.ts',
    'tests/e2e/mixerAdvanced.spec.ts',
    'tests/e2e/mixerAiHealthTestId.spec.ts',
    'tests/e2e/mixerBusMasterChain.spec.ts',
    'tests/e2e/mixerChannelGainTestId.spec.ts',
    'tests/e2e/mixerChannelWidthKeyboardTestId.spec.ts',
    'tests/e2e/mixerDeepTemplateTestId.spec.ts',
    'tests/e2e/mixerFullWorkflowTestId.spec.ts',
    'tests/e2e/mixerSnapshotRecallTestId.spec.ts',
    'tests/e2e/mixerSnapshotTestId.spec.ts',
    'tests/e2e/mixerSendsRoutingTestId.spec.ts',
    'tests/e2e/mixerStripDeviceChain.spec.ts',
    'tests/e2e/mixerTestId.spec.ts',
    'tests/e2e/mixerUndoRedo.spec.ts',
    'tests/e2e/mixerWidthSendsTestId.spec.ts',
];
const TRANSPORT_SPECS = [
    'tests/e2e/transport.spec.ts',
    'tests/e2e/transportAdvanced.spec.ts',
    'tests/e2e/transportAndWorkspaceDeep.spec.ts',
    'tests/e2e/transportCompleteLifecycle.spec.ts',
    'tests/e2e/transportDeep.spec.ts',
    'tests/e2e/transportResponsive.spec.ts',
    'tests/e2e/transportTemplateTestId.spec.ts',
    'tests/e2e/transportTestId.spec.ts',
    'tests/e2e/mixerUndoRedo.spec.ts',
];
const PRESENTATION_SPECS: Readonly<Record<string, readonly string[]>> = {
    'src/modules/Tuner/presentations/views/TunerPanel.tsx': [
        'tests/e2e/tuner.spec.ts',
        'tests/e2e/tunerReferenceHomeEnd.spec.ts',
    ],
    'src/modules/AudioRendering/presentations/views/ExportDialog.tsx': [
        'tests/e2e/export.spec.ts',
        'tests/e2e/exportAudioEvidence.spec.ts',
        'tests/e2e/exportRangeSelection.spec.ts',
        'tests/e2e/exportStemsModeTestId.spec.ts',
        'tests/e2e/exportTailInputTestId.spec.ts',
        'tests/e2e/exportTestId.spec.ts',
        'tests/e2e/exportFidelityTestId.spec.ts',
        'tests/e2e/exportFormatsTestId.spec.ts',
        'tests/e2e/exportRangeTailTestId.spec.ts',
    ],
    'src/modules/Preferences/presentations/views/PreferencesDialog.tsx': PREFERENCES_SPECS,
    'src/modules/Preferences/presentations/views/preferencesShared.tsx': PREFERENCES_SPECS,
    'src/modules/Preferences/presentations/views/ShortcutsSection.tsx': PREFERENCES_SPECS,
    'src/modules/Preferences/presentations/views/preferences/GeneralSection.tsx': PREFERENCES_SPECS,
    'src/modules/Preferences/presentations/views/preferences/AppearanceSection.tsx': PREFERENCES_SPECS,
    'src/modules/Preferences/presentations/views/preferences/MidiSection.tsx': PREFERENCES_SPECS,
    'src/modules/Preferences/presentations/views/preferences/LayoutSection.tsx': PREFERENCES_SPECS,
    'src/modules/Preferences/presentations/components/CaptureKeyButton.tsx': PREFERENCES_SPECS,
    'src/modules/MixerConsole/presentations/views/MixerPanel.tsx': MIXER_SPECS,
    'src/modules/MixerConsole/presentations/views/Mixer/SendsSection.tsx': MIXER_SPECS,
    'src/modules/MixerConsole/presentations/views/Mixer/MixerPopupMenu.tsx': MIXER_SPECS,
    'src/modules/MixerConsole/presentations/views/Mixer/MixerLevelReadout.tsx': MIXER_SPECS,
    'src/modules/MixerConsole/presentations/views/Mixer/MixHealthDialog.tsx': MIXER_SPECS,
    'src/modules/MixerConsole/presentations/views/Mixer/MidiFxSection.tsx': MIXER_SPECS,
    'src/modules/MixerConsole/presentations/views/Mixer/MasterChannelStrip.tsx': MIXER_SPECS,
    'src/modules/MixerConsole/presentations/views/Mixer/IOSection.tsx': MIXER_SPECS,
    'src/modules/MixerConsole/presentations/views/Mixer/ExpandedChannelStrip.tsx': MIXER_SPECS,
    'src/modules/MixerConsole/presentations/views/Mixer/DeviceChainSection.tsx': MIXER_SPECS,
    'src/modules/WorkspaceShell/presentations/views/TransportBar.tsx': TRANSPORT_SPECS,
    'src/modules/WorkspaceShell/presentations/views/Transport/TransportControls.tsx': TRANSPORT_SPECS,
};

// Explicit operational entry points: adding a new script never silently opts out.
const REVIEW_TOOLING = new Set([
    'acceptReview',
    'claimTrackerIssue',
    'confirmReviewRepairs',
    'deliverPullRequest',
    'fileTrackerIssue',
    'prepareReview',
    'prepareReviewEntry',
    'publishLane',
    'publishReview',
    'reconcileTrackerIssue',
    'recoverDeliveryLock',
    'recoverPublishReviewLock',
    'repairReviewFinding',
    'reviewApprovalFormat',
    'reviewDocumentParser',
    'reviewDossier',
    'reviewDossierBindings',
    'reviewerModelDiversity',
    'reviewRoundEscalation',
    'reviewShadowStatus',
    'reviewDiffSummary',
    'reviewCommentDiffPreflight',
    'reviewBundleLocator',
    'reviewApprovalContext',
    'deliveryRemoteInspection',
    'deliveryLockLegacyIncidents',
    'pullRequestReviewState',
    'pullRequestMutationLock',
    'pruneLane',
    'removeLane',
    'stackedLanes',
    'stampLaneIdentity',
    'supersedePullRequest',
    'supersedePullRequestGh',
    'syncParentLane',
    'trackerIssueReconciliation',
]);

export type BrowserMatrix = { include: { id: number; specs: string[] }[] };
export type ValidationPlan = {
    version: 1;
    browser: boolean;
    browserAi: boolean;
    codeql: boolean;
    matrix: BrowserMatrix;
    reasons: { path: string; reason: string }[];
};

function isDocumentation(path: string): boolean {
    return path.endsWith('.md') && (path.startsWith('docs/') || path.startsWith('.agents/') || !path.includes('/'));
}

function needsCodeql(path: string): boolean {
    return (
        /\.(?:[cm]?[jt]sx?)$/.test(path) ||
        path.startsWith('.github/') ||
        /^(?:package\.json|pnpm-lock\.yaml|tsconfig[^/]*\.json|\.gitleaks\.toml)$/.test(path)
    );
}

function isReviewTooling(path: string): boolean {
    if (path.startsWith('scripts/semanticReview/')) {
        return true;
    }
    const match = /^scripts\/(?:__tests__\/)?([A-Za-z]+)(?:\.spec)?\.ts$/.exec(path);
    const scriptName = match?.[1];
    return scriptName !== undefined && REVIEW_TOOLING.has(scriptName);
}

function isSpec(path: string): boolean {
    return path.startsWith('tests/e2e/') && /\.spec\.tsx?$/.test(path) && !path.includes('/__tests__/');
}

export function parseChangedPaths(diff: string): string[] {
    if (diff === '') {
        throw new Error('Changed-path diff is empty');
    }
    const fields = diff.split('\0');
    if (fields.pop() !== '') {
        throw new Error('Changed-path diff must be NUL terminated');
    }
    const paths = new Set<string>();
    for (let index = 0; index < fields.length;) {
        const status = fields[index++];
        if (status === undefined || !/^(?:[AMDUT]|[RC]\d+)$/.test(status)) {
            throw new Error(`Unsupported diff status: ${status}`);
        }
        const count = /^[RC]/.test(status) ? 2 : 1;
        for (let offset = 0; offset < count; offset++) {
            const path = fields[index++];
            if (!path || path.startsWith('/') || path.split('/').includes('..')) {
                throw new Error('Invalid changed path');
            }
            paths.add(path);
        }
    }
    return [...paths].sort();
}

export function selectValidationPlan(paths: readonly string[], availableSpecs: readonly string[]): ValidationPlan {
    const inventory = [...new Set(availableSpecs)].sort();
    if (inventory.some((path) => !isSpec(path))) {
        throw new Error('Invalid E2E inventory');
    }
    const available = new Set(inventory);
    const selected = new Set<string>();
    const reasons: ValidationPlan['reasons'] = [];
    let broad = false;
    let browser = false;
    let browserAi = false;
    let codeql = false;
    for (const path of paths) {
        if (isDocumentation(path)) {
            reasons.push({ path, reason: 'documentation; no browser execution' });
            continue;
        }
        codeql ||= needsCodeql(path);
        if (isReviewTooling(path)) {
            reasons.push({ path, reason: 'known review tooling; security/static checks without browser execution' });
            continue;
        }
        browser = true;
        const mapped = PRESENTATION_SPECS[path];
        if (mapped) {
            for (const spec of mapped) {
                if (!available.has(spec)) {
                    throw new Error(`Mapped E2E spec is missing: ${spec}`);
                }
                selected.add(spec);
            }
            reasons.push({ path, reason: 'mapped presentation entry point and its browser workflows' });
        } else if (isSpec(path) && available.has(path)) {
            selected.add(path);
            // Hardware policy is shared by these browser proofs; keep both host branches.
            if (path.startsWith('tests/e2e/browserAi')) {
                browserAi = true;
            }
            reasons.push({ path, reason: 'changed browser spec' });
        } else {
            broad = true;
            browserAi = true;
            reasons.push({
                path,
                reason: 'shared, deleted, renamed, or unclassified dependency; full browser coverage',
            });
        }
    }
    if (browser && !available.has(SMOKE_SPEC)) {
        throw new Error(`Required smoke spec is missing: ${SMOKE_SPEC}`);
    }
    const specs = (broad ? inventory : [...selected].sort()).filter((path) => path !== SMOKE_SPEC);
    if (broad && specs.length === 0) {
        throw new Error('Full browser coverage has no specs');
    }
    const count = Math.min(12, Math.ceil(specs.length / 12));
    const matrix: BrowserMatrix = {
        include: Array.from({ length: count }, (_, index) => ({ id: index + 1, specs: [] })),
    };
    for (const [index, spec] of specs.entries()) {
        const group = matrix.include[index % count];
        if (group === undefined) {
            throw new Error('Invalid E2E partition');
        }
        group.specs.push(spec);
    }
    return { version: 1, browser, browserAi, codeql, matrix, reasons };
}

export function selectedSpecArguments(value: unknown, root: string): string[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error('Selected E2E specs must be a nonempty string list');
    }
    const specs: string[] = [];
    for (const path of value as unknown[]) {
        if (typeof path !== 'string') {
            throw new TypeError('Selected E2E specs must be a nonempty string list');
        }
        specs.push(path);
    }
    if (new Set(specs).size !== specs.length) {
        throw new Error('Selected E2E specs must be unique');
    }
    return specs.map((path) => {
        if (!isSpec(path) || path.split('/').includes('..') || !existsSync(resolve(root, path))) {
            throw new Error(`Selected E2E spec is invalid or missing: ${path}`);
        }
        // Playwright CLI arguments are regexes against absolute file paths, not literals.
        return `^${resolve(root, path).replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
    });
}

function listSpecs(root: string): string[] {
    const specs: string[] = [];
    for (const entry of readdirSync(resolve(root, 'tests/e2e'), { recursive: true })) {
        if (typeof entry !== 'string') {
            continue;
        }
        const path = `tests/e2e/${entry}`;
        if (isSpec(path)) {
            specs.push(path);
        }
    }
    return specs;
}

function main(): void {
    const root = process.cwd();
    if (process.argv[2] === 'run') {
        const args = selectedSpecArguments(JSON.parse(process.env.E2E_SPECS ?? 'null'), root);
        const result = spawnSync('pnpm', ['test:e2e', ...args, '--retries=0', '--reporter=blob'], { stdio: 'inherit' });
        if (result.error) {
            throw result.error;
        }
        process.exitCode = result.status ?? 1;
        return;
    }
    if (process.argv[2] !== 'plan') {
        throw new Error('Expected plan or run');
    }
    const { BASE_SHA: base, HEAD_SHA: head, GITHUB_OUTPUT: output } = process.env;
    if (!base || !head || !/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head) || !output) {
        throw new Error('Plan requires immutable base/head SHAs and GITHUB_OUTPUT');
    }
    const diff = execFileSync('git', ['diff', '--name-status', '-z', '--find-renames', `${base}...${head}`, '--'], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
    });
    const plan = selectValidationPlan(parseChangedPaths(diff), listSpecs(root));
    writeFileSync('pr-validation-scope.json', `${JSON.stringify(plan, null, 2)}\n`);
    appendFileSync(
        output,
        `browser=${plan.browser}\nbrowser-ai=${plan.browserAi}\ncodeql=${plan.codeql}\nmatrix=${JSON.stringify(plan.matrix)}\n`
    );
    console.log(JSON.stringify(plan, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
