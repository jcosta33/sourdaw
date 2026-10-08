import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import { parseChangedPaths, selectedSpecArguments, selectValidationPlan, SMOKE_SPEC } from '../prValidationScope';

const TUNER = 'src/modules/Tuner/presentations/views/TunerPanel.tsx';
const TUNER_SPECS = ['tests/e2e/tuner.spec.ts', 'tests/e2e/tunerReferenceHomeEnd.spec.ts'];
const EXPORT = 'src/modules/AudioRendering/presentations/views/ExportDialog.tsx';
const PREFERENCES = 'src/modules/Preferences/presentations/views/preferences/AppearanceSection.tsx';
const GENERAL_PREFERENCES = 'src/modules/Preferences/presentations/views/preferences/GeneralSection.tsx';
const MIDI_PREFERENCES = 'src/modules/Preferences/presentations/views/preferences/MidiSection.tsx';
const AUTO_SAVE_INTERVAL_SPEC = 'tests/e2e/autoSaveInterval.spec.ts';
const UI_SCALE_KEYBOARD_SPEC = 'tests/e2e/uiScaleKeyboardTestId.spec.ts';
const MIDI_VELOCITY_KEYBOARD_SPEC = 'tests/e2e/midiVelocityKeyboardTestId.spec.ts';
const PREFERENCE_SPECS = [
    AUTO_SAVE_INTERVAL_SPEC,
    'tests/e2e/preferencesDialogDeepTestId.spec.ts',
    'tests/e2e/shortcutBehavioralE2E.spec.ts',
    'tests/e2e/browserDisplayScale.spec.ts',
    'tests/e2e/transportResponsive.spec.ts',
    'tests/e2e/pianoRollDockAcceptance.spec.ts',
    UI_SCALE_KEYBOARD_SPEC,
    MIDI_VELOCITY_KEYBOARD_SPEC,
];
const MIXER = 'src/modules/MixerConsole/presentations/views/MixerPanel.tsx';
const EXPANDED_MIXER = 'src/modules/MixerConsole/presentations/views/Mixer/ExpandedChannelStrip.tsx';
const MASTER_MIXER = 'src/modules/MixerConsole/presentations/views/Mixer/MasterChannelStrip.tsx';
const SOLO_SAFE_SPEC = 'tests/e2e/soloSafeToggleTestId.spec.ts';
const MASTER_GAIN_SPECS = ['tests/e2e/masterChannelTestId.spec.ts', 'tests/e2e/masterGainKeyboardTestId.spec.ts'];
const TRANSPORT = 'src/modules/WorkspaceShell/presentations/views/Transport/TransportControls.tsx';
const METRONOME_VOLUME_SPEC = 'tests/e2e/metronomeVolumeSliderTestId.spec.ts';
const COUNT_IN_CYCLE_SPEC = 'tests/e2e/countInCycleTestId.spec.ts';
const MIXER_SPECS_FOR_CONTROLS = [
    'mixer',
    'mixerAdvanced',
    'mixerAiHealthTestId',
    'mixerBusMasterChain',
    'mixerChannelGainTestId',
    'mixerChannelWidthKeyboardTestId',
    'mixerDeepTemplateTestId',
    'mixerFullWorkflowTestId',
    'mixerSnapshotRecallTestId',
    'mixerSnapshotTestId',
    'mixerSendsRoutingTestId',
    'mixerStripDeviceChain',
    'mixerTestId',
    'mixerUndoRedo',
    'mixerWidthSendsTestId',
    'soloSafeToggleTestId',
    'masterChannelTestId',
    'masterGainKeyboardTestId',
].map((name) => `tests/e2e/${name}.spec.ts`);
const TRANSPORT_SPECS_FOR_CONTROLS = [
    'transport',
    'transportAdvanced',
    'transportAndWorkspaceDeep',
    'transportCompleteLifecycle',
    'transportDeep',
    'transportResponsive',
    'transportTemplateTestId',
    'transportTestId',
    'mixerUndoRedo',
    'metronomeVolumeSliderTestId',
    'countInCycleTestId',
].map((name) => `tests/e2e/${name}.spec.ts`);
const INVENTORY = [SMOKE_SPEC, ...TUNER_SPECS, 'tests/e2e/undo.spec.ts'];
const PR_4890_PATHS = [
    '.agents/skills/review-stances/correctness.md',
    'scripts/__tests__/semanticReviewContext.spec.ts',
    'scripts/semanticReview/__tests__/semanticReview.spec.ts',
    'scripts/semanticReview/admissionBytes.ts',
    'scripts/semanticReview/candidateFindings.ts',
    'scripts/semanticReview/contracts.ts',
    'scripts/semanticReview/evidence.ts',
    'scripts/semanticReview/evidenceOrdering.ts',
    'scripts/semanticReview/fit.ts',
    'scripts/semanticReview/interpret.ts',
    'scripts/semanticReview/provider.ts',
    'scripts/semanticReview/requestPayload.ts',
    'scripts/semanticReview/rules.ts',
    'scripts/semanticReview/run.ts',
    'scripts/semanticReview/verify.ts',
    'scripts/semanticReview/withheldReasons.ts',
    'scripts/semanticReviewContext.ts',
];
const PR_4902_PATHS = [
    'scripts/__tests__/agentDeliveryScripts.spec.ts',
    'scripts/__tests__/prepareReview.spec.ts',
    'scripts/reviewRiskPolicy.ts',
    'scripts/savedProjectStatePaths.ts',
    'scripts/semanticReview/__tests__/semanticReview.spec.ts',
    'scripts/semanticReview/rules.ts',
    'scripts/trustedGithubWriteBootstrap.ts',
];
const KNOWN_NODE_REVIEW_TOOLING = [
    'scripts/checkStancesRecord.ts',
    'scripts/__tests__/checkStancesRecord.spec.ts',
    'scripts/typesafeRequest.ts',
    'scripts/__tests__/typesafeRequest.spec.ts',
    'scripts/semanticReviewEvaluation.ts',
    'scripts/semanticReviewMeasurement.ts',
    'scripts/__tests__/semanticReviewMeasurement.spec.ts',
    'scripts/semanticReview/__tests__/candidateFindings.spec.ts',
    'scripts/semanticReview/__tests__/changeFacts.spec.ts',
    'scripts/semanticReview/__tests__/digestProbes.ts',
    'scripts/semanticReview/changeFacts.ts',
    'scripts/semanticReview/evaluation/__tests__/semanticEvaluation.spec.ts',
    'scripts/semanticReview/evaluation/corpus.ts',
    'scripts/semanticReview/evaluation/runEvaluation.ts',
    'scripts/semanticReview/evaluation/semanticEvaluationCorpus.json',
    'scripts/semanticReviewMeasurement/artifacts.ts',
    'scripts/semanticReviewMeasurement/contracts.ts',
    'scripts/semanticReviewMeasurement/gaps.ts',
    'scripts/semanticReviewMeasurement/record.ts',
];
const NEW_REVIEW_TOOLING_PATHS = [
    'scripts/__tests__/agentDeliveryScripts.spec.ts',
    'scripts/reviewRiskPolicy.ts',
    'scripts/savedProjectStatePaths.ts',
    'scripts/trustedGithubWriteBootstrap.ts',
];
const folders: string[] = [];
const callerTrace2Event = process.env.GIT_TRACE2_EVENT;

function temporaryRoot(): string {
    const folder = mkdtempSync(join(tmpdir(), 'pr-validation-scope-'));
    folders.push(folder);
    return folder;
}

function allSelected(plan: ReturnType<typeof selectValidationPlan>): string[] {
    return plan.matrix.include.flatMap((group) => group.specs).sort();
}

function fullInventory(inventory: readonly string[]): string[] {
    return Array.from(new Set(inventory))
        .filter((spec) => spec !== SMOKE_SPEC)
        .sort();
}

function cleanupTemporaryRoots(remove: typeof rmSync = rmSync): void {
    try {
        for (const folder of folders.splice(0)) {
            remove(folder, { recursive: true, force: true });
        }
    } finally {
        vi.unstubAllEnvs();
    }
}

afterEach(() => cleanupTemporaryRoots());

beforeEach(() => {
    vi.stubEnv('GIT_TRACE2_EVENT', '0');
});

describe('required affected verification', () => {
    it('disables inherited Trace2 for disposable Git fixture children', () => {
        const root = temporaryRoot();
        execFileSync('git', ['init', '--quiet'], { cwd: root });

        const result = spawnSync('git', ['-c', 'alias.trace2probe=!printf %s "$GIT_TRACE2_EVENT"', 'trace2probe'], {
            cwd: root,
            encoding: 'utf8',
        });

        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe('0');
    });

    it('restores the caller Trace2 setting and propagates cleanup errors', () => {
        const root = temporaryRoot();
        const cleanupError = new Error('fixture cleanup failed');

        try {
            expect(() =>
                cleanupTemporaryRoots(() => {
                    throw cleanupError;
                })
            ).toThrow(cleanupError);
            expect(process.env.GIT_TRACE2_EVENT).toBe(callerTrace2Event);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('runs browser verification inside the required PR Gate, never on approval', () => {
        const health = parse(readFileSync('.github/workflows/health-gates.yml', 'utf8'));
        const heavy = parse(readFileSync('.github/workflows/heavy-gates.yml', 'utf8'));
        expect(Object.keys(heavy.on)).toEqual(['workflow_call']);
        expect(health.jobs.gate.needs).toContain('affected');
    });

    it('does not start browser or security analysis for documentation', () => {
        expect(selectValidationPlan(['docs/06-testing.md', 'AGENTS.md'], INVENTORY)).toMatchObject({
            profile: 'docs',
            browser: false,
            browserAi: false,
            codeql: false,
            matrix: { include: [] },
        });
    });

    it('keeps known review tooling security checked without browser execution', () => {
        expect(
            selectValidationPlan(['scripts/publishReview.ts', 'scripts/__tests__/reviewDossier.spec.ts'], INVENTORY)
        ).toMatchObject({
            profile: 'tooling',
            browser: false,
            browserAi: false,
            codeql: true,
            matrix: { include: [] },
        });
    });

    it('keeps the exact 17 paths of PR 4890 in the tooling scope', () => {
        const plan = selectValidationPlan(PR_4890_PATHS, INVENTORY);
        expect(plan).toMatchObject({ profile: 'tooling', browser: false, browserAi: false, codeql: true });
        expect(plan.matrix.include).toEqual([]);
        expect(plan.reasons.map(({ path }) => path)).toEqual(PR_4890_PATHS);
    });

    it('keeps the exact seven paths of PR 4902 in tooling scope', () => {
        const plan = selectValidationPlan(PR_4902_PATHS, INVENTORY);
        expect(plan).toMatchObject({ profile: 'tooling', browser: false, browserAi: false, codeql: true });
        expect(plan.matrix.include).toEqual([]);
        expect(plan.reasons.map(({ path }) => path)).toEqual(PR_4902_PATHS);
    });

    it.each(NEW_REVIEW_TOOLING_PATHS)('recognizes added review tooling path %s', (path) => {
        expect(selectValidationPlan([path], INVENTORY)).toMatchObject({
            profile: 'tooling',
            browser: false,
            browserAi: false,
            codeql: true,
            matrix: { include: [] },
        });
    });

    it.each(KNOWN_NODE_REVIEW_TOOLING)('keeps known Node-only review tooling %s out of browser jobs', (path) => {
        expect(selectValidationPlan([path], INVENTORY)).toMatchObject({
            profile: 'tooling',
            browser: false,
            browserAi: false,
            codeql: path.endsWith('.ts'),
            matrix: { include: [] },
        });
    });

    it('plans immutable Node-only review changes without browser jobs, but widens mixed product and config changes', () => {
        const root = temporaryRoot();
        const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
        mkdirSync(join(root, 'tests/e2e'), { recursive: true });
        writeFileSync(join(root, SMOKE_SPEC), '// smoke fixture\n');
        writeFileSync(join(root, 'tests/e2e/undo.spec.ts'), '// browser fixture\n');
        git(['init', '--quiet']);
        git(['config', 'user.email', 'ci@example.invalid']);
        git(['config', 'user.name', 'Scope test']);
        git(['add', 'tests/e2e']);
        git(['commit', '--quiet', '-m', 'base']);
        const base = git(['rev-parse', 'HEAD']);
        const nodePaths = [
            'scripts/checkStancesRecord.ts',
            'scripts/typesafeRequest.ts',
            'scripts/semanticReview/evaluation/runEvaluation.ts',
            'scripts/semanticReview/evaluation/semanticEvaluationCorpus.json',
            'scripts/semanticReviewMeasurement/record.ts',
        ];
        for (const path of nodePaths) {
            mkdirSync(join(root, path.slice(0, path.lastIndexOf('/'))), { recursive: true });
            writeFileSync(join(root, path), path.endsWith('.json') ? '{}\n' : 'export const fixture = true;\n');
        }
        git(['add', ...nodePaths]);
        git(['commit', '--quiet', '-m', 'Node-only review tooling']);
        const output = join(root, 'output');
        const planAt = (startingSha: string) => {
            const result = spawnSync(process.execPath, [resolve('scripts/prValidationScope.ts'), 'plan'], {
                cwd: root,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    BASE_SHA: startingSha,
                    HEAD_SHA: git(['rev-parse', 'HEAD']),
                    GITHUB_OUTPUT: output,
                },
            });
            expect(result.status, result.stderr).toBe(0);
            const plan: unknown = JSON.parse(readFileSync(join(root, 'pr-validation-scope.json'), 'utf8'));
            return plan;
        };
        const tooling = planAt(base);
        expect(tooling).toMatchObject({
            profile: 'tooling',
            browser: false,
            browserAi: false,
            codeql: true,
            matrix: { include: [] },
        });
        expect(tooling).toMatchObject({
            reasons: [...nodePaths].sort().map((path) => ({
                path,
                reason: 'known review tooling; security/static checks without browser execution',
            })),
        });
        expect(readFileSync(output, 'utf8')).toContain(
            'profile=tooling\nbrowser=false\nbrowser-ai=false\ncodeql=true\n'
        );
        mkdirSync(join(root, 'src/app'), { recursive: true });
        writeFileSync(join(root, 'src/app/bootstrap.ts'), '// product fixture\n');
        writeFileSync(join(root, 'vite.config.ts'), '// config fixture\n');
        git(['add', 'src/app/bootstrap.ts', 'vite.config.ts']);
        git(['commit', '--quiet', '-m', 'mixed product and config']);
        const broad = planAt(base);
        expect(broad).toMatchObject({ profile: 'broad', browser: true, browserAi: true, codeql: true });
        expect(broad).toMatchObject({ matrix: { include: [{ id: 1, specs: ['tests/e2e/undo.spec.ts'] }] } });
        const broadHead = git(['rev-parse', 'HEAD']);
        const unknown = 'scripts/semanticReview/newBuildStep.ts';
        writeFileSync(join(root, unknown), 'export const fixture = true;\n');
        git(['add', unknown]);
        git(['commit', '--quiet', '-m', 'unknown semantic module']);
        const unknownPlan = planAt(broadHead);
        expect(unknownPlan).toMatchObject({ profile: 'broad', browser: true, browserAi: true });
        expect(unknownPlan).toMatchObject({ matrix: { include: [{ id: 1, specs: ['tests/e2e/undo.spec.ts'] }] } });
        const unknownHead = git(['rev-parse', 'HEAD']);
        writeFileSync(join(root, 'scripts/e2eServerIdentity.ts'), 'export const fixture = true;\n');
        git(['add', 'scripts/e2eServerIdentity.ts']);
        git(['commit', '--quiet', '-m', 'browser-owned script helper']);
        const browserOwned = planAt(unknownHead);
        expect(browserOwned).toMatchObject({ profile: 'broad', browser: true, browserAi: true });
        expect(browserOwned).toMatchObject({ matrix: { include: [{ id: 1, specs: ['tests/e2e/undo.spec.ts'] }] } });
    });

    it('uses broad scope for mixed, unknown, and build paths', () => {
        for (const path of [
            'src/app/bootstrap.ts',
            'scripts/newBuildStep.ts',
            'scripts/semanticReview/newBuildStep.ts',
            'package.json',
        ]) {
            expect(selectValidationPlan([...PR_4890_PATHS, path], INVENTORY)).toMatchObject({
                profile: 'broad',
                browser: true,
                browserAi: true,
            });
        }
    });

    it('keeps mixed product, unknown, and lookalike paths broad', () => {
        for (const path of [
            'src/app/bootstrap.ts',
            'scripts/newBuildStep.ts',
            'scripts/agentDeliveryScriptsLookalike.ts',
            'scripts/__tests__/agentDeliveryScriptsLookalike.spec.ts',
        ]) {
            expect(selectValidationPlan([...PR_4902_PATHS, path], INVENTORY)).toMatchObject({
                profile: 'broad',
                browser: true,
                browserAi: true,
                codeql: true,
            });
        }
    });

    it('keeps either side of a rename or deletion in the classification', () => {
        const renamedToUnknown = parseChangedPaths('R100\0scripts/semanticReviewContext.ts\0scripts/newBuildStep.ts\0');
        const renamedFromUnknown = parseChangedPaths(
            'R100\0scripts/newBuildStep.ts\0scripts/semanticReviewContext.ts\0'
        );
        expect(selectValidationPlan(renamedToUnknown, INVENTORY).profile).toBe('broad');
        expect(selectValidationPlan(renamedFromUnknown, INVENTORY).profile).toBe('broad');
        const reviewToolRenamedToUnknown = parseChangedPaths(
            'R100\0scripts/reviewRiskPolicy.ts\0scripts/newBuildStep.ts\0'
        );
        const reviewToolRenamedFromUnknown = parseChangedPaths(
            'R100\0scripts/newBuildStep.ts\0scripts/reviewRiskPolicy.ts\0'
        );
        expect(selectValidationPlan(reviewToolRenamedToUnknown, INVENTORY).profile).toBe('broad');
        expect(selectValidationPlan(reviewToolRenamedFromUnknown, INVENTORY).profile).toBe('broad');
        expect(
            selectValidationPlan(parseChangedPaths('D\0scripts/semanticReviewContext.ts\0'), INVENTORY).profile
        ).toBe('tooling');
    });

    it.each([TUNER, EXPORT])('widens product presentation %s to every browser proof', (path) => {
        const familySpecs = readdirSync('tests/e2e')
            .filter((name) => /^(?:tuner|export).*\.spec\.tsx?$/.test(name))
            .map((name) => `tests/e2e/${name}`);
        const inventory = [
            SMOKE_SPEC,
            ...familySpecs,
            'tests/e2e/browserDisplayScale.spec.ts',
            'tests/e2e/undo.spec.ts',
        ];
        const plan = selectValidationPlan([path], inventory);
        expect(plan.browser).toBe(true);
        expect(plan.browserAi).toBe(true);
        expect(allSelected(plan)).toEqual(fullInventory(inventory));
        expect(allSelected(plan)).toContain('tests/e2e/browserDisplayScale.spec.ts');
    });

    it.each([
        PREFERENCES,
        GENERAL_PREFERENCES,
        MIDI_PREFERENCES,
        'src/modules/Preferences/presentations/views/ShortcutsSection.tsx',
        'src/modules/Preferences/presentations/views/preferences/LayoutSection.tsx',
        'src/modules/Preferences/presentations/components/CaptureKeyButton.tsx',
    ])('widens former preference mapping %s to the complete browser inventory', (path) => {
        const inventory = [...INVENTORY, ...PREFERENCE_SPECS];
        const plan = selectValidationPlan([path], inventory);
        expect(allSelected(plan)).toEqual(fullInventory(inventory));
        expect(plan.browserAi).toBe(true);
    });

    it('widens preference producers and omitted sections', () => {
        const inventory = [...INVENTORY, ...PREFERENCE_SPECS];
        for (const path of [
            'src/modules/Preferences/stores/preferencesStore.ts',
            'src/modules/Preferences/presentations/views/preferences/AiSection.tsx',
        ]) {
            expect(allSelected(selectValidationPlan([path], inventory))).toEqual(fullInventory(inventory));
        }
    });

    it('selects the auto-save interval persistence proof for General preferences', () => {
        const inventory = [...INVENTORY, ...PREFERENCE_SPECS];
        expect(allSelected(selectValidationPlan([GENERAL_PREFERENCES], inventory))).toContain(AUTO_SAVE_INTERVAL_SPEC);
    });

    it('selects the existing UI Scale and MIDI velocity keyboard proofs for their preference sections', () => {
        const inventory = [...INVENTORY, ...PREFERENCE_SPECS];
        expect(allSelected(selectValidationPlan([PREFERENCES], inventory))).toContain(UI_SCALE_KEYBOARD_SPEC);
        expect(allSelected(selectValidationPlan([MIDI_PREFERENCES], inventory))).toContain(MIDI_VELOCITY_KEYBOARD_SPEC);
    });

    it.each([
        MIXER,
        EXPANDED_MIXER,
        MASTER_MIXER,
        'src/modules/MixerConsole/presentations/views/Mixer/SendsSection.tsx',
        'src/modules/MixerConsole/presentations/views/Mixer/MixerPopupMenu.tsx',
        'src/modules/MixerConsole/presentations/views/Mixer/MixerLevelReadout.tsx',
        'src/modules/MixerConsole/presentations/views/Mixer/MixHealthDialog.tsx',
        'src/modules/MixerConsole/presentations/views/Mixer/MidiFxSection.tsx',
        'src/modules/MixerConsole/presentations/views/Mixer/IOSection.tsx',
        'src/modules/MixerConsole/presentations/views/Mixer/DeviceChainSection.tsx',
        TRANSPORT,
    ])('widens former mixer or transport mapping %s to every browser proof and hardware', (path) => {
        const inventory = [...INVENTORY, ...MIXER_SPECS_FOR_CONTROLS, ...TRANSPORT_SPECS_FOR_CONTROLS];
        const plan = selectValidationPlan([path], inventory);
        expect(allSelected(plan)).toEqual(fullInventory(inventory));
        expect(plan.browserAi).toBe(true);
    });

    it('selects the Solo Safe and master-gain witnesses for the mixer controls that own them', () => {
        const inventory = [...INVENTORY, ...MIXER_SPECS_FOR_CONTROLS];
        expect(allSelected(selectValidationPlan([EXPANDED_MIXER], inventory))).toContain(SOLO_SAFE_SPEC);
        for (const witness of MASTER_GAIN_SPECS) {
            expect(allSelected(selectValidationPlan([MASTER_MIXER], inventory))).toContain(witness);
        }
    });

    it('selects the metronome-volume and simultaneous punch/count-in witnesses for transport controls', () => {
        const inventory = [...INVENTORY, ...TRANSPORT_SPECS_FOR_CONTROLS];
        const selected = allSelected(selectValidationPlan([TRANSPORT], inventory));
        expect(selected).toContain(METRONOME_VOLUME_SPEC);
        expect(selected).toContain(COUNT_IN_CYCLE_SPEC);
    });

    it.each([
        'src/modules/Preferences/presentations/views/PreferencesDialog.tsx',
        'src/modules/Preferences/presentations/views/preferencesShared.tsx',
        'src/modules/WorkspaceShell/presentations/views/TransportBar.tsx',
    ])('widens cross-feature presentation shell %s to every browser proof', (path) => {
        const inventory = [
            ...INVENTORY,
            ...PREFERENCE_SPECS,
            ...MIXER_SPECS_FOR_CONTROLS,
            ...TRANSPORT_SPECS_FOR_CONTROLS,
        ];
        const plan = selectValidationPlan([path], inventory);
        expect(allSelected(plan)).toEqual(
            Array.from(new Set(inventory))
                .filter((spec) => spec !== SMOKE_SPEC)
                .sort()
        );
        expect(plan.browserAi).toBe(true);
    });

    it.each([
        'src/app/bootstrap.ts',
        'src/modules/Unknown/reader.ts',
        'src/modules/Tuner/stores/tunerStore.ts',
        'tests/e2e/e2eUtils.ts',
        'package.json',
        'pnpm-lock.yaml',
        'playwright.config.ts',
        'scripts/newBuildStep.ts',
    ])('widens unknown/shared dependency %s to all browser proofs and hardware', (path) => {
        const plan = selectValidationPlan([path], INVENTORY);
        expect(allSelected(plan)).toEqual(INVENTORY.filter((spec) => spec !== SMOKE_SPEC).sort());
        expect(plan).toMatchObject({ browser: true, browserAi: true, codeql: true });
    });

    it('runs a changed spec directly without accidentally matching neighboring names', () => {
        const plan = selectValidationPlan(['tests/e2e/undo.spec.ts'], INVENTORY);
        expect(allSelected(plan)).toEqual(['tests/e2e/undo.spec.ts']);
        expect(plan.browser).toBe(true);
        const tsx = 'tests/e2e/editor.spec.tsx';
        expect(allSelected(selectValidationPlan([tsx], [...INVENTORY, tsx]))).toEqual([tsx]);
    });

    it.each([
        'tests/e2e/editor.test.ts',
        'tests/e2e/editor.test.tsx',
        'tests/e2e/editor.spec.js',
        'tests/e2e/editor.test.mjs',
        'tests/e2e/editor.spec.cts',
        'tests/e2e/editor.test.mtsx',
        'tests/e2e/nested/editor.spec.tsx',
        'tests/e2e/nested/fourth.TEST.ts',
    ])('selects a changed Playwright filename %s directly', (spec) => {
        const inventory = [...INVENTORY, spec];
        const plan = selectValidationPlan([spec], inventory);
        expect(allSelected(plan)).toEqual([spec]);
        expect(plan.browserAi).toBe(spec.startsWith('tests/e2e/browserAi'));
    });

    it('includes every admitted filename in broad browser coverage once', () => {
        const additional = ['tests/e2e/alpha.test.ts', 'tests/e2e/nested/beta.spec.tsx', 'tests/e2e/gamma.test.mjs'];
        const inventory = [...INVENTORY, ...additional, 'tests/e2e/alpha.test.ts'];
        expect(allSelected(selectValidationPlan(['src/app/bootstrap.ts'], inventory))).toEqual(
            fullInventory(inventory)
        );
    });

    it('falls back to full coverage for a changed uppercase extension', () => {
        const path = 'tests/e2e/rejected.Spec.MJS';
        expect(() => selectValidationPlan(['src/app/bootstrap.ts'], [...INVENTORY, path])).toThrow(
            'Invalid E2E inventory'
        );
        const plan = selectValidationPlan([path], INVENTORY);
        expect(allSelected(plan)).toEqual(fullInventory(INVENTORY));
        expect(plan.reasons).toContainEqual({
            path,
            reason: 'product, shared, deleted, renamed, or unclassified dependency; full browser coverage',
        });
    });

    it.each([
        'tests/e2e/__tests__/nested.test.ts',
        'tests/e2e/nested/__tests__/case.spec.ts',
        'tests/e2e/__TESTS__/ignored.test.ts',
        'tests/e2e/nested/node_modules/dependency.test.ts',
        'tests/e2e/helper.ts',
        'tests/e2e/case.spec.ts.bak',
        'tests/other/case.test.ts',
        'tests/e2e/../outside.test.ts',
    ])('rejects a path Playwright does not collect: %s', (path) => {
        expect(() => selectValidationPlan(['src/app/bootstrap.ts'], [...INVENTORY, path])).toThrow(
            'Invalid E2E inventory'
        );
        expect(allSelected(selectValidationPlan([path], INVENTORY))).toEqual(fullInventory(INVENTORY));
    });

    it('plans direct default-named tests and carries the same inventory into broad coverage', () => {
        const root = temporaryRoot();
        const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
        mkdirSync(join(root, 'tests/e2e/nested/__tests__'), { recursive: true });
        mkdirSync(join(root, 'tests/e2e/__TESTS__'), { recursive: true });
        writeFileSync(join(root, SMOKE_SPEC), '// smoke fixture\n');
        writeFileSync(join(root, 'tests/e2e/nested/__tests__/excluded.test.ts'), '// excluded fixture\n');
        writeFileSync(join(root, 'tests/e2e/__TESTS__/ignored.test.ts'), '// excluded fixture\n');
        mkdirSync(join(root, 'tests/e2e/fake.spec.ts'));
        writeFileSync(join(root, 'tests/e2e/rejected.Spec.MJS'), '// Playwright does not collect this extension\n');
        git(['init', '--quiet']);
        git(['config', 'user.email', 'ci@example.invalid']);
        git(['config', 'user.name', 'Scope test']);
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'base']);
        const base = git(['rev-parse', 'HEAD']);
        const added = [
            'tests/e2e/new-default.test.ts',
            'tests/e2e/another.spec.js',
            'tests/e2e/nested/third.test.mtsx',
            'tests/e2e/nested/fourth.TEST.ts',
        ];
        for (const spec of added) {
            writeFileSync(join(root, spec), '// new Playwright test\n');
        }
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'add Playwright test']);
        const output = join(root, 'output');
        const result = spawnSync(process.execPath, [resolve('scripts/prValidationScope.ts'), 'plan'], {
            cwd: root,
            encoding: 'utf8',
            env: { ...process.env, BASE_SHA: base, HEAD_SHA: git(['rev-parse', 'HEAD']), GITHUB_OUTPUT: output },
        });
        expect(result.status, result.stderr).toBe(0);
        const plan = JSON.parse(readFileSync(join(root, 'pr-validation-scope.json'), 'utf8'));
        expect(allSelected(plan)).toEqual(added.sort());
        expect(plan.reasons).toEqual([
            { path: 'tests/e2e/another.spec.js', reason: 'changed browser spec' },
            { path: 'tests/e2e/nested/fourth.TEST.ts', reason: 'changed browser spec' },
            { path: 'tests/e2e/nested/third.test.mtsx', reason: 'changed browser spec' },
            { path: 'tests/e2e/new-default.test.ts', reason: 'changed browser spec' },
        ]);
        mkdirSync(join(root, 'src/app'), { recursive: true });
        writeFileSync(join(root, 'src/app/bootstrap.ts'), '// product change\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'change product']);
        const broad = spawnSync(process.execPath, [resolve('scripts/prValidationScope.ts'), 'plan'], {
            cwd: root,
            encoding: 'utf8',
            env: { ...process.env, BASE_SHA: base, HEAD_SHA: git(['rev-parse', 'HEAD']), GITHUB_OUTPUT: output },
        });
        expect(broad.status, broad.stderr).toBe(0);
        expect(allSelected(JSON.parse(readFileSync(join(root, 'pr-validation-scope.json'), 'utf8')))).toEqual(added);
        const broadHead = git(['rev-parse', 'HEAD']);
        writeFileSync(join(root, 'tests/e2e/new-rejected.Spec.MJS'), '// excluded extension change\n');
        git(['add', 'tests/e2e/new-rejected.Spec.MJS']);
        git(['commit', '--quiet', '-m', 'add excluded extension']);
        const fallback = spawnSync(process.execPath, [resolve('scripts/prValidationScope.ts'), 'plan'], {
            cwd: root,
            encoding: 'utf8',
            env: { ...process.env, BASE_SHA: broadHead, HEAD_SHA: git(['rev-parse', 'HEAD']), GITHUB_OUTPUT: output },
        });
        expect(fallback.status, fallback.stderr).toBe(0);
        const fallbackPlan = JSON.parse(readFileSync(join(root, 'pr-validation-scope.json'), 'utf8'));
        expect(allSelected(fallbackPlan)).toEqual(added);
        expect(fallbackPlan.reasons).toEqual([
            {
                path: 'tests/e2e/new-rejected.Spec.MJS',
                reason: 'product, shared, deleted, renamed, or unclassified dependency; full browser coverage',
            },
        ]);
    });

    it('widens deleted tests and both sides of a move outside a known mapping', () => {
        const paths = parseChangedPaths(
            `R100\0${TUNER}\0src/components/TunerPanel.tsx\0D\0tests/e2e/deleted.spec.ts\0`
        );
        expect(paths).toEqual([TUNER, 'src/components/TunerPanel.tsx', 'tests/e2e/deleted.spec.ts'].sort());
        expect(allSelected(selectValidationPlan(paths, INVENTORY))).toEqual(
            INVENTORY.filter((spec) => spec !== SMOKE_SPEC).sort()
        );
    });

    it('rejects empty full coverage and missing smoke instead of reducing coverage', () => {
        expect(() => selectValidationPlan([TUNER], [SMOKE_SPEC])).toThrow('Full browser coverage has no specs');
        expect(() => selectValidationPlan(['src/app/bootstrap.ts'], TUNER_SPECS)).toThrow(
            'Required smoke spec is missing'
        );
    });

    it('rejects malformed diff records instead of treating them as no changes', () => {
        expect(() => parseChangedPaths('')).toThrow('empty');
        expect(() => parseChangedPaths('M\0src/app.ts')).toThrow('NUL terminated');
        expect(() => parseChangedPaths('R100\0old\0')).toThrow('Invalid changed path');
        expect(() => parseChangedPaths('X\0unknown\0')).toThrow('Unsupported diff status');
        expect(() => parseChangedPaths('M\0../outside\0')).toThrow('Invalid changed path');
    });

    it('reserves CodeQL for executable JS/TS and security configuration', () => {
        expect(selectValidationPlan(['src/assets/texture.png'], INVENTORY).codeql).toBe(false);
        expect(selectValidationPlan(['src/styles/transport.css'], INVENTORY).codeql).toBe(false);
        expect(selectValidationPlan(['crates/audio/src/lib.rs'], INVENTORY).codeql).toBe(false);
        expect(selectValidationPlan(['.github/workflows/health-gates.yml'], INVENTORY).codeql).toBe(true);
        expect(selectValidationPlan(['src/app/bootstrap.ts'], INVENTORY).codeql).toBe(true);
    });

    it('partitions a wide selection once per file into at most twelve nonempty groups', () => {
        const specs = Array.from({ length: 200 }, (_, index) => `tests/e2e/case${index}.spec.ts`);
        const plan = selectValidationPlan(['src/app/bootstrap.ts'], [SMOKE_SPEC, ...specs]);
        expect(plan.matrix.include).toHaveLength(12);
        expect(allSelected(plan)).toEqual(specs.sort());
        expect(plan.matrix.include.every((group) => group.specs.length > 0)).toBe(true);
    });

    it('refuses empty, duplicated, missing and escaping spec arguments', () => {
        for (const value of [
            null,
            [],
            [TUNER],
            ['tests/e2e/missing.spec.ts'],
            ['tests/e2e/../outside.spec.ts'],
            ['tests/e2e/missing.test.ts'],
            ['tests/e2e/__tests__/nested.test.ts'],
            ['tests/e2e/case.spec.ts.bak'],
            [SMOKE_SPEC, SMOKE_SPEC],
        ]) {
            expect(() => selectedSpecArguments(value, process.cwd())).toThrow();
        }
    });

    it('accepts regular default-named files and rejects a directory with a matching suffix', () => {
        const root = temporaryRoot();
        const spec = 'tests/e2e/nested/a[1]+.test.mjs';
        const directory = 'tests/e2e/fake.spec.ts';
        mkdirSync(join(root, 'tests/e2e/nested'), { recursive: true });
        mkdirSync(join(root, directory));
        writeFileSync(join(root, spec), '');
        const [argument] = selectedSpecArguments([spec], root);
        if (argument === undefined) {
            throw new Error('Expected a Playwright file argument');
        }
        expect(new RegExp(argument).test(join(root, spec))).toBe(true);
        expect(new RegExp(argument).test(join(root, 'tests/e2e/nested/a111x.test.mjs'))).toBe(false);
        expect(() => selectedSpecArguments([directory], root)).toThrow('invalid or missing');
    });

    it('accepts a mixed-case Playwright filename as a literal selected argument', () => {
        const root = temporaryRoot();
        const spec = 'tests/e2e/nested/a[1]+.TEST.ts';
        mkdirSync(join(root, 'tests/e2e/nested'), { recursive: true });
        writeFileSync(join(root, spec), '');
        const argument = selectedSpecArguments([spec], root).at(0);
        if (argument === undefined) {
            throw new Error('Expected a Playwright file argument');
        }
        expect(new RegExp(argument).test(join(root, spec))).toBe(true);
        expect(new RegExp(argument).test(join(root, 'tests/e2e/nested/a111.TEST.ts'))).toBe(false);
    });

    it('rejects an existing file whose extension is uppercase', () => {
        const root = temporaryRoot();
        const spec = 'tests/e2e/rejected.Spec.MJS';
        mkdirSync(join(root, 'tests/e2e'), { recursive: true });
        writeFileSync(join(root, spec), '');
        expect(() => selectedSpecArguments([spec], root)).toThrow(`Selected E2E spec is invalid or missing: ${spec}`);
    });

    it('anchors literal arguments so regex metacharacters cannot broaden selected files', () => {
        const root = temporaryRoot();
        mkdirSync(join(root, 'tests/e2e'), { recursive: true });
        const spec = 'tests/e2e/a[1]+.spec.ts';
        writeFileSync(join(root, spec), '');
        const argument = selectedSpecArguments([spec], root).at(0);
        if (argument === undefined) {
            throw new Error('Expected a Playwright file argument');
        }
        const regex = new RegExp(argument);
        expect(regex.test(join(root, spec))).toBe(true);
        expect(regex.test(join(root, 'tests/e2e/a111xspec.ts'))).toBe(false);
        expect(regex.test(`${join(root, spec)}extra`)).toBe(false);
    });

    it('propagates a selected browser process failure without shell evaluation', () => {
        const root = temporaryRoot();
        const bin = join(root, 'pnpm');
        const argsFile = join(root, 'args.json');
        writeFileSync(
            bin,
            `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.ARGUMENTS_FILE, JSON.stringify(process.argv.slice(2)));process.exit(43);\n`,
            { mode: 0o755 }
        );
        const result = spawnSync(process.execPath, [resolve('scripts/prValidationScope.ts'), 'run'], {
            env: {
                ...process.env,
                PATH: `${root}:${process.env.PATH}`,
                E2E_SPECS: JSON.stringify([SMOKE_SPEC]),
                ARGUMENTS_FILE: argsFile,
            },
            encoding: 'utf8',
        });
        expect(result.status, result.stderr).toBe(43);
        expect(JSON.parse(readFileSync(argsFile, 'utf8'))).toEqual([
            'test:e2e',
            ...selectedSpecArguments([SMOKE_SPEC], process.cwd()),
            '--retries=0',
            '--reporter=blob',
        ]);
    });

    it('builds the manifest from immutable Git refs and includes rename source and destination', () => {
        const root = temporaryRoot();
        const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
        mkdirSync(join(root, 'tests/e2e'), { recursive: true });
        for (const spec of INVENTORY) {
            writeFileSync(join(root, spec), '// fixture\n');
        }
        git(['init', '--quiet']);
        git(['config', 'user.email', 'ci@example.invalid']);
        git(['config', 'user.name', 'Scope test']);
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'base']);
        const base = git(['rev-parse', 'HEAD']);
        git(['mv', 'tests/e2e/undo.spec.ts', 'tests/e2e/renamed.spec.ts']);
        git(['commit', '--quiet', '-m', 'rename']);
        const output = join(root, 'output');
        const result = spawnSync(process.execPath, [resolve('scripts/prValidationScope.ts'), 'plan'], {
            cwd: root,
            encoding: 'utf8',
            env: { ...process.env, BASE_SHA: base, HEAD_SHA: git(['rev-parse', 'HEAD']), GITHUB_OUTPUT: output },
        });
        expect(result.status, result.stderr).toBe(0);
        const plan = JSON.parse(readFileSync(join(root, 'pr-validation-scope.json'), 'utf8'));
        expect(plan.reasons.map((entry: { path: string }) => entry.path)).toEqual([
            'tests/e2e/renamed.spec.ts',
            'tests/e2e/undo.spec.ts',
        ]);
        expect(plan.browserAi).toBe(true);
        expect(readFileSync(output, 'utf8')).toContain('browser=true\n');
    });
});
