const SHELL_SETUP_PREFIXES = ['set ', 'export ', 'unset '] as const;

function stripShellComment(line: string): string {
    let inSingle = false;
    let inDouble = false;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === "'" && !inDouble) {
            inSingle = !inSingle;
        }
        if (character === '"' && !inSingle) {
            inDouble = !inDouble;
        }
        if (character === '#' && !inSingle && !inDouble) {
            return line.slice(0, index).trim();
        }
    }
    return line.trim();
}

function isNonExecutableShellLine(line: string): boolean {
    if (line === '' || line.startsWith('#')) {
        return true;
    }
    if (SHELL_SETUP_PREFIXES.some((prefix) => line.startsWith(prefix))) {
        return true;
    }
    if (/^(echo|printf)\b/u.test(line)) {
        return true;
    }
    return false;
}

export function shellRunExecutesCommand(run: string, command: string): boolean {
    for (const rawLine of run.split('\n')) {
        const line = stripShellComment(rawLine);
        if (isNonExecutableShellLine(line)) {
            continue;
        }
        if (line === command || line.startsWith(`${command} `)) {
            return true;
        }
    }
    return false;
}

export function runInvokesVercelPull(run: string): boolean {
    for (const rawLine of run.split('\n')) {
        const line = stripShellComment(rawLine);
        if (isNonExecutableShellLine(line)) {
            continue;
        }
        if (/\$VERCEL_CLI[^\n]*\bpull\b/u.test(line)) {
            return true;
        }
        if (/\bvercel(?:@\d+\.\d+\.\d+)?\b[^\n]*\bpull\b|\bpull\b[^\n]*\bvercel(?:@\d+\.\d+\.\d+)?\b/iu.test(line)) {
            return true;
        }
    }
    return false;
}

export function assertDeployWebBuildRun(buildRun: string): void {
    if (!shellRunExecutesCommand(buildRun, 'pnpm build')) {
        throw new Error('Build the validated revision must execute pnpm build');
    }
    if (!shellRunExecutesCommand(buildRun, 'node scripts/writeVercelPrebuiltOutput.ts')) {
        throw new Error('Build the validated revision must execute node scripts/writeVercelPrebuiltOutput.ts');
    }
    if (buildRun.includes('$VERCEL_CLI') || buildRun.includes('vercel')) {
        throw new Error('Build the validated revision must not invoke the Vercel CLI');
    }
}

type WorkflowStep = {
    readonly name?: unknown;
    readonly run?: unknown;
};

export function assertDeployWebJobNoVercelPull(steps: readonly unknown[]): void {
    for (const candidate of steps) {
        if (typeof candidate !== 'object' || candidate === null) {
            continue;
        }
        const step = candidate as WorkflowStep;
        const run = typeof step.run === 'string' ? step.run : '';
        if (runInvokesVercelPull(run)) {
            throw new Error('the daily deploy train must not pull the production environment through the Vercel CLI');
        }
    }
}
