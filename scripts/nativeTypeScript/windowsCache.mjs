import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { win32 } from 'node:path';

// SystemRoot belongs to the trusted calling process, while cache paths remain
// untrusted data. Never select the verifier through PATH. Path checks have the same private-fence scope
// as Unix ownership checks; they do not promise atomic handle-based execution.
export function windowsPrivateCache(request) {
    if (process.platform !== 'win32') throw new Error('Windows cache verification requires Windows');
    const systemRoot = process.env.SystemRoot;
    if (
        !systemRoot ||
        !/^[A-Za-z]:\\/u.test(systemRoot) ||
        !win32.isAbsolute(systemRoot) ||
        win32.normalize(systemRoot) !== systemRoot
    )
        throw new Error('A trusted absolute Windows SystemRoot is required');
    const home = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0');
    const powershell = win32.join(home, 'powershell.exe');
    // The fixed owned body avoids script-file execution policy changes. JSON
    // stdin carries every pathname; no input becomes PowerShell command text.
    const command = readFileSync(new URL('./windows-cache.ps1', import.meta.url), 'utf8');
    const output = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], {
        shell: false,
        input: JSON.stringify({ ...request, schemaVersion: 1 }),
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        env: { ...process.env, PSModulePath: win32.join(home, 'Modules') },
    });
    const result = JSON.parse(output.replace(/^\uFEFF/u, ''));
    if (
        !result ||
        Object.keys(result).sort().join(',') !== 'result,schemaVersion,status' ||
        result.schemaVersion !== 1 ||
        result.status !== 'verified' ||
        typeof result.result !== 'string' ||
        !result.result
    )
        throw new Error('Invalid Windows private-cache verification result');
    return result.result;
}
