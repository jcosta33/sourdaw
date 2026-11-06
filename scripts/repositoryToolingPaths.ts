/** Per-vendor agent guidance, read by coding agents and never loaded by the product. */
const AGENT_GUIDANCE_NAMES = new Set(['AGENTS.md', 'CLAUDE.md', 'CODEX.md', 'GEMINI.md', 'KIMI.md', 'ZCODE.md']);

function isAgentGuidance(path: string): boolean {
    return /^(?:src|tests)\//.test(path) && AGENT_GUIDANCE_NAMES.has(path.slice(path.lastIndexOf('/') + 1));
}

/**
 * Rust sources and Cargo manifests reach the browser only as compiled WASM under public/wasm and
 * src/modules/AudioEngine/wasm, which are changed paths that select browser coverage themselves;
 * the broad profile's `wasm:verify` fails a Rust change that lacks regenerated artifacts. Other files
 * under crates/ are data a Playwright spec may read directly, so they stay on the product route.
 */
function isRustCompilerInput(path: string): boolean {
    return (
        /^crates\/.+\.rs$/.test(path) ||
        /^crates\/.+\/Cargo\.toml$/.test(path) ||
        path === 'Cargo.toml' ||
        path === 'Cargo.lock' ||
        path === 'rust-toolchain.toml'
    );
}

/** The nightly workflow answers to schedule and dispatch events alone, so no pull request runs it. */
function isNightlyWorkflow(path: string): boolean {
    return path === '.github/workflows/nightly.yml';
}

/** Agent-campaign corpora and manifest are read by Vitest specs and scripts, never by product or Playwright code. */
function isAgentCampaignEvidence(path: string): boolean {
    return path.startsWith('evidence/');
}

/**
 * Root lint, format, dead-code, and module-boundary configuration is read only by those tools: no
 * Vite build, dev server, Playwright configuration, or spec loads it, Tailwind scans only the
 * sources src/styles/main.css names, and the broad profile's lint and boundary jobs are where a
 * change to it can fail. TypeScript project files stay on the product
 * route, because the build reads them, except the lint-only project nothing else extends.
 */
const STATIC_ANALYSIS_CONFIG = new Set([
    '.editorconfig',
    '.oxlintrc.json',
    '.prettierignore',
    '.prettierrc',
    'eslint.config.mjs',
    'eslint.size-baseline.d.mts',
    'eslint.size-baseline.mjs',
    'knip.json',
    'oxlint.craft-baseline.d.mts',
    'oxlint.craft-baseline.mjs',
    'tsconfig.eslint.json',
]);

function isStaticAnalysisConfig(path: string): boolean {
    return STATIC_ANALYSIS_CONFIG.has(path) || /^\.dependency-cruiser[\w.-]*\.(?:cjs|json)$/.test(path);
}

/**
 * Repository tooling and prose never select browser execution, though they keep broad non-browser
 * validation. Generator and build scripts reach the browser only through their outputs, which land
 * under src/ or public/ and select browser coverage there. Product trees may load Markdown, so it
 * stays classified with them. Agent guidance under src/ and tests/ is the exception, because no
 * product code loads it.
 */
export function isRepositoryTooling(path: string): boolean {
    return (
        path.startsWith('scripts/') ||
        path.startsWith('.agents/') ||
        path === '.gitleaksignore' ||
        path === '.gitleaks.toml' ||
        isRustCompilerInput(path) ||
        isNightlyWorkflow(path) ||
        isAgentCampaignEvidence(path) ||
        isStaticAnalysisConfig(path) ||
        /^release\/[^/]+\.json$/.test(path) ||
        (path.endsWith('.md') && (!/^(?:src|public|tests)\//.test(path) || isAgentGuidance(path)))
    );
}
