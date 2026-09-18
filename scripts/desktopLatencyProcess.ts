/**
 * The measurement's own use of a packaged-app session: launch the shipped
 * binary through `launchPackagedApp`, take the two legs on the page it hands
 * back, and tear the session down however the run ends.
 *
 * The spawn, connect and teardown themselves live in `packagedAppSession.ts`,
 * shared with `proveDesktopAgentWorkspace.ts`; `stripPayloadOverrides` and
 * `removeProfileDir` are re-exported here because they are this driver's
 * documented surface and carry their spec under that name.
 */

import { measureOnPage, type MeasuredLegs } from './desktopLatencyConnect.ts';
import { printDiagnostics, type Diagnostics } from './desktopLatencyDiagnostics.ts';
import { launchPackagedApp } from './packagedAppSession.ts';

export {
    removeProfileDir,
    stripPayloadOverrides,
    type ProfileRemoval,
    type StrippedEnv,
} from './packagedAppSession.ts';

/**
 * Launches the packaged app against the given isolated profile and runs the
 * full measurement on it, then tears the session down — the app process, the
 * temporary profile directory, and the signal listeners registered for the
 * run — regardless of how it ends. Rethrows whatever the launch or the
 * measurement failed with; the caller decides what that means for the run's
 * own verdict.
 */
export async function launchAndMeasure(
    binary: string,
    profileDir: string,
    seconds: number,
    pluginPath: string,
    diagnostics: Diagnostics
): Promise<MeasuredLegs> {
    const app = await launchPackagedApp(binary, profileDir, diagnostics);
    try {
        const measured = await measureOnPage(app.page, seconds, pluginPath, diagnostics);
        return { ...measured, version: app.version };
    } catch (error) {
        process.stdout.write(`\n--- packaged app output ---\n${app.output().trim()}\n`);
        printDiagnostics(diagnostics);
        throw error;
    } finally {
        await app.quit();
    }
}
