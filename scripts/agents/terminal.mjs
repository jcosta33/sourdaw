import { spawnSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Resolve the effective terminal backend based on config/flag/platform.
 * @param {string} requested  - 'auto'|'current'|'terminal'|'iterm'
 * @returns {string}
 */
export function resolveBackend(requested) {
    if (requested === 'auto') {
        return process.platform === 'darwin' ? 'terminal' : 'current';
    }
    return requested;
}

/**
 * Build the banner string for display before agent launch.
 * @param {object} info
 * @returns {string}
 */
function buildBanner(info) {
    return [
        `Task:      ${info.title}`,
        `Slug:      ${info.slug}`,
        `Branch:    ${info.branch}`,
        `Task file: ${info.taskFile}`,
        ``,
        `Launching ${info.agent}...`,
    ].join('\n');
}

/**
 * Launch the agent in the given backend.
 * @param {string} backend  - resolved backend name
 * @param {string} worktreePath - absolute path to worktree
 * @param {string} agentCmd
 * @param {string[]} agentArgs
 * @param {object} bannerInfo
 */
export function launch(backend, worktreePath, agentCmd, agentArgs, bannerInfo) {
    switch (backend) {
        case 'current':
            return launchCurrent(worktreePath, agentCmd, agentArgs, bannerInfo);
        case 'terminal':
            return launchTerminalApp(worktreePath, agentCmd, agentArgs, bannerInfo);
        case 'iterm':
            return launchIterm(worktreePath, agentCmd, agentArgs, bannerInfo);
        default:
            throw new Error(`Unsupported terminal backend: "${backend}". Supported: auto, current, terminal, iterm`);
    }
}

/**
 * Launch in the current terminal session (blocking — agent takes over stdio).
 */
function launchCurrent(worktreePath, agentCmd, agentArgs, bannerInfo) {
    process.chdir(worktreePath);
    process.stdout.write('\x1Bc'); // clear screen
    console.log(buildBanner(bannerInfo));
    console.log('');

    const result = spawnSync(agentCmd, agentArgs, {
        cwd: worktreePath,
        stdio: 'inherit',
        shell: false,
    });

    if (result.error) {
        // If --name is unsupported by the agent, retry without it
        const filteredArgs = stripFlag('--name', agentArgs);
        if (filteredArgs.length !== agentArgs.length) {
            const retry = spawnSync(agentCmd, filteredArgs, {
                cwd: worktreePath,
                stdio: 'inherit',
                shell: false,
            });
            if (retry.error) throw new Error(`Failed to launch ${agentCmd}: ${retry.error.message}`);
            process.exit(retry.status || 0);
        }
        throw new Error(`Failed to launch ${agentCmd}: ${result.error.message}`);
    }
    process.exit(result.status || 0);
}

/**
 * Remove a --flag <value> pair from an args array.
 * @param {string} flag  - e.g. '--name'
 * @param {string[]} args
 * @returns {string[]}
 */
function stripFlag(flag, args) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === flag) {
            i++;
            continue;
        }
        out.push(args[i]);
    }
    return out;
}

/**
 * Write a self-deleting launch script to a temp file, avoiding all
 * shell-escaping issues when passing paths/args through AppleScript.
 * @returns {string} path to the temp script
 */
function writeLaunchScript(worktreePath, agentCmd, agentArgs, bannerInfo) {
    const banner = buildBanner(bannerInfo);
    // Use printf '%s\n' to safely print banner regardless of special chars in title
    const lines = [
        '#!/bin/sh',
        `cd ${posixQuote(worktreePath)}`,
        'clear',
        `printf '%s\\n\\n' ${posixQuote(banner)}`,
        [agentCmd, ...agentArgs].map(posixQuote).join(' '),
    ];
    const scriptPath = join(tmpdir(), `agents-launch-${process.pid}-${Date.now()}.sh`);
    writeFileSync(scriptPath, lines.join('\n') + '\n', { mode: 0o755 });
    return scriptPath;
}

/**
 * POSIX single-quote a string so it is safe to embed in a shell command.
 * Works for any string including those with spaces, $, backticks, newlines, etc.
 * @param {string} str
 * @returns {string}
 */
function posixQuote(str) {
    return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Launch in a new macOS Terminal.app window.
 * Uses a temp shell script to avoid AppleScript string-escaping issues.
 */
function launchTerminalApp(worktreePath, agentCmd, agentArgs, bannerInfo) {
    const scriptPath = writeLaunchScript(worktreePath, agentCmd, agentArgs, bannerInfo);

    // The only thing injected into AppleScript is the script path.
    // tmpdir() on macOS (/var/folders/... or /tmp) never contains single quotes.
    const appleScript = `
    tell application "Terminal"
      activate
      do script "exec sh ${posixQuote(scriptPath)}"
    end tell
  `;

    const result = spawnSync('osascript', ['-e', appleScript], {
        encoding: 'utf8',
        stdio: 'pipe',
    });

    if (result.status !== 0) {
        try {
            unlinkSync(scriptPath);
        } catch {
            /* best effort */
        }
        const err = (result.stderr || '').trim();
        throw new Error(`Failed to open Terminal.app: ${err || 'unknown AppleScript error'}`);
    }

    console.log(`Opened Terminal.app for: ${bannerInfo.slug}`);
}

/**
 * Launch in iTerm2.
 * Uses a temp shell script to avoid AppleScript string-escaping issues.
 */
function launchIterm(worktreePath, agentCmd, agentArgs, bannerInfo) {
    const scriptPath = writeLaunchScript(worktreePath, agentCmd, agentArgs, bannerInfo);

    const appleScript = `
    tell application "iTerm"
      activate
      tell current window
        create tab with default profile
        tell current session of current tab
          write text "exec sh ${posixQuote(scriptPath)}"
        end tell
      end tell
    end tell
  `;

    const result = spawnSync('osascript', ['-e', appleScript], {
        encoding: 'utf8',
        stdio: 'pipe',
    });

    if (result.status !== 0) {
        try {
            unlinkSync(scriptPath);
        } catch {
            /* best effort */
        }
        const err = (result.stderr || '').trim();
        throw new Error(`Failed to open iTerm2: ${err || 'unknown AppleScript error'}`);
    }

    console.log(`Opened iTerm2 for: ${bannerInfo.slug}`);
}

/**
 * Check if a terminal backend is available on this system.
 * @param {string} backend
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkBackend(backend) {
    switch (backend) {
        case 'current':
            return { ok: true };
        case 'terminal':
            if (process.platform !== 'darwin') return { ok: false, reason: 'Terminal.app is macOS only' };
            return { ok: true };
        case 'iterm': {
            if (process.platform !== 'darwin') return { ok: false, reason: 'iTerm2 is macOS only' };
            const r = spawnSync('osascript', ['-e', 'id of application "iTerm"'], {
                encoding: 'utf8',
                stdio: 'pipe',
            });
            return r.status === 0 ? { ok: true } : { ok: false, reason: 'iTerm2 not found' };
        }
        case 'auto':
            return { ok: true };
        default:
            return { ok: false, reason: `Unknown backend: ${backend}` };
    }
}
