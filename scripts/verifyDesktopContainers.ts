import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { emptyDiagnostics, printDiagnostics } from './desktopLatencyDiagnostics.ts';
import { dismissAlphaNotice, dismissOnboardingTour, openNewProjectFromLaunchScreen } from './desktopLatencyLaunch.ts';
import { launchPackagedApp, STEP_TIMEOUT_MS } from './packagedAppSession.ts';
import { verifyDesktopPayload } from './verifyDesktopPayload.ts';

function command(program: string, args: string[], cwd?: string): void {
    const result = spawnSync(program, args, { cwd, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${program} exited ${String(result.status)}`);
}

async function one(directory: string, suffix: string): Promise<string> {
    const matches = (await readdir(directory)).filter((name) => name.endsWith(suffix));
    if (matches.length !== 1) throw new Error(`Expected one ${suffix} in ${directory}, found ${matches.length}`);
    return join(directory, matches[0]);
}

async function verifyMacWorkspace(extracted: string, temp: string): Promise<void> {
    const profile = await mkdtemp(join(temp, 'profile-'));
    const diagnostics = emptyDiagnostics();
    const binary = join(extracted, 'Sourdaw.app', 'Contents', 'MacOS', 'Sourdaw');
    const app = await launchPackagedApp(binary, profile, diagnostics);
    try {
        await app.page.locator('#launch-new-project').waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
        await openNewProjectFromLaunchScreen(app.page, STEP_TIMEOUT_MS);
        // On a fresh profile AppShell shows this only after project.initialized.
        await app.page.getByRole('button', { name: 'Let me cook', exact: true }).waitFor({
            state: 'visible',
            timeout: STEP_TIMEOUT_MS,
        });
        await dismissAlphaNotice(app.page, STEP_TIMEOUT_MS);
        const panel = app.page.locator('[aria-label="Browser panel"]');
        if ((await panel.count()) === 0) {
            await app.page.locator('[aria-label="Toggle browser"]').click({ timeout: STEP_TIMEOUT_MS });
        }
        await panel.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
        await dismissOnboardingTour(app.page, STEP_TIMEOUT_MS);
        await panel.getByRole('tab', { name: 'Effects', exact: true }).waitFor({
            state: 'visible',
            timeout: STEP_TIMEOUT_MS,
        });
    } catch (error) {
        process.stdout.write(`\n--- packaged app output ---\n${app.output().trim()}\n`);
        printDiagnostics(diagnostics);
        throw error;
    } finally {
        await app.quit();
    }
}

const root = process.cwd();
const output = resolve(root, 'release/desktop');
const temp = await mkdtemp(join(tmpdir(), 'sourdaw-desktop-acceptance-'));
try {
    if (process.platform === 'darwin' && process.arch === 'arm64') {
        const mount = join(temp, 'mount');
        command('hdiutil', ['attach', await one(output, '.dmg'), '-nobrowse', '-readonly', '-mountpoint', mount]);
        try {
            command('codesign', ['--verify', '--deep', '--strict', join(mount, 'Sourdaw.app')]);
            await verifyDesktopPayload(mount, 'darwin', 3, root);
        } finally {
            command('hdiutil', ['detach', mount]);
        }
        const extracted = join(temp, 'zip');
        command('ditto', ['-x', '-k', await one(output, '.zip'), extracted]);
        command('codesign', ['--verify', '--deep', '--strict', join(extracted, 'Sourdaw.app')]);
        await verifyDesktopPayload(extracted, 'darwin', 3, root);
        await verifyMacWorkspace(extracted, temp);
    } else if (process.platform === 'linux' && process.arch === 'x64') {
        const artifact = await one(output, '.AppImage');
        command(artifact, ['--appimage-extract'], temp);
        await verifyDesktopPayload(join(temp, 'squashfs-root'), 'linux', 1, root);
    } else if (process.platform === 'win32' && process.arch === 'x64') {
        const installed = join(temp, 'installed');
        command(await one(output, '.exe'), ['/S', `/D=${installed}`]);
        await verifyDesktopPayload(installed, 'win32', 1, root);
    } else {
        throw new Error(`Unsupported hosted target ${process.platform}/${process.arch}`);
    }
} finally {
    await rm(temp, { recursive: true, force: true });
}
