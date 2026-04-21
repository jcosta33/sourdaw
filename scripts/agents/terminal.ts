import { spawnSync, spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { cyan, dim, bold, blue } from './colors.ts';
import { writeState } from './state.ts';

/**
 * Resolve the effective terminal backend based on config/flag/platform.
 * @param {string} requested  - 'auto'|'current'|'terminal'|'iterm'|'linux-auto'|'windows-auto'
 * @returns {string}
 */
export function resolveBackend(requested) {
    if (requested === 'auto') {
        if (process.platform === 'darwin') return 'terminal';
        if (process.platform === 'win32') return 'windows-auto';
        return 'linux-auto';
    }
    return requested;
}

/**
 * Build the banner string for display before agent launch.
 * @param {object} info
 * @returns {string}
 */
function buildBanner(info) {
    const titleWidth = Math.max(0, 50 - info.title.length - 3);
    return [
        `\n${cyan('┌')} ${bold(cyan(info.title))} ${cyan('─'.repeat(titleWidth))}`,
        `${cyan('│')} ${dim('Slug:')}      ${info.slug}`,
        `${cyan('│')} ${dim('Branch:')}    ${info.branch}`,
        `${cyan('│')} ${dim('Task file:')} ${info.taskFile}`,
        `${cyan('└' + '─'.repeat(50))}\n`,
        `${blue('i')} Launching ${bold(info.agent)}...\n`,
    ].join('\n');
}

/**
 * Launch the agent in the given backend.
 * @param {string} backend  - resolved backend name
 * @param {string} worktreePath - absolute path to worktree
 * @param {string} agentCmd
 * @param {string[]} agentArgs
 * @param {object} bannerInfo
 * @param {string} repoRoot
 */
export function launch(backend, worktreePath, agentCmd, agentArgs, bannerInfo, repoRoot) {
    switch (backend) {
        case 'current':
            return launchCurrent(worktreePath, agentCmd, agentArgs, bannerInfo, repoRoot);
        case 'terminal':
            return launchTerminalApp(worktreePath, agentCmd, agentArgs, bannerInfo, repoRoot);
        case 'iterm':
            return launchIterm(worktreePath, agentCmd, agentArgs, bannerInfo, repoRoot);
        case 'linux-auto':
            return launchLinuxAuto(worktreePath, agentCmd, agentArgs, bannerInfo, repoRoot);
        case 'windows-auto':
            return launchWindowsAuto(worktreePath, agentCmd, agentArgs, bannerInfo, repoRoot);
        default:
            throw new Error(`Unsupported terminal backend: "${backend}". Supported: auto, current, terminal, iterm`);
    }
}

/**
 * Launch in the current terminal session (blocking — agent takes over stdio).
 */
function launchCurrent(worktreePath, agentCmd, agentArgs, bannerInfo, repoRoot) {
    process.chdir(worktreePath);
    process.stdout.write('\x1Bc'); // clear screen
    console.log(buildBanner(bannerInfo));
    console.log('');
    
    if (repoRoot) {
        writeState(repoRoot, bannerInfo.slug, {
             backend: 'current',
             agent: bannerInfo.agent,
             status: 'running',
             pid: process.pid // in current mode, the node script blocks and acts as the agent process owner
        });
    }

    const result = spawnSync(agentCmd, agentArgs, {
        cwd: worktreePath,
        stdio: 'inherit',
        shell: false,
    });

    if (repoRoot) {
        writeState(repoRoot, bannerInfo.slug, {
             status: result.error ? 'failed' : 'stopped',
             exitCode: result.status,
             error: result.error ? result.error.message : null
        });
    }

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
function launchTerminalApp(worktreePath, agentCmd, agentArgs, bannerInfo, repoRoot) {
    if (repoRoot) {
        writeState(repoRoot, bannerInfo.slug, {
             backend: 'terminal',
             agent: bannerInfo.agent,
             status: 'launched', // we don't have the PID for the AppleScript window
        });
    }
    const scriptPath = writeLaunchScript(worktreePath, agentCmd, agentArgs, bannerInfo, repoRoot);

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
function launchIterm(worktreePath, agentCmd, agentArgs, bannerInfo, repoRoot) {
    if (repoRoot) {
        writeState(repoRoot, bannerInfo.slug, {
             backend: 'iterm',
             agent: bannerInfo.agent,
             status: 'launched', // we don't have the PID for the AppleScript window
        });
    }
    const scriptPath = writeLaunchScript(worktreePath, agentCmd, agentArgs, bannerInfo, repoRoot);

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
        case 'linux-auto':
            if (process.platform === 'win32' || process.platform === 'darwin') return { ok: false, reason: 'linux-auto requires Linux' };
            return { ok: true };
        case 'windows-auto':
            if (process.platform !== 'win32') return { ok: false, reason: 'windows-auto requires Windows' };
            return { ok: true };
        case 'auto':
            return { ok: true }; // Resolve logic handles auto -> OS specific
        default:
            return { ok: false, reason: `Unknown terminal backend: ${backend}` };
    }
}

/**
 * Launch in a new Linux terminal.
 * Tries gnome-terminal, konsole, xfce4-terminal, xterm.
 */
function launchLinuxAuto(worktreePath, agentCmd, agentArgs, bannerInfo, repoRoot) {
    if (repoRoot) {
        writeState(repoRoot, bannerInfo.slug, {
             backend: 'linux-auto',
             agent: bannerInfo.agent,
             status: 'launched',
        });
    }
    const scriptPath = writeLaunchScript(worktreePath, agentCmd, agentArgs, bannerInfo, repoRoot);
    
    const terminals = [
        ['gnome-terminal', '--', 'bash', '-c'],
        ['konsole', '-e', 'bash', '-c'],
        ['xfce4-terminal', '-e', 'bash', '-c'],
        ['xterm', '-e', 'bash', '-c']
    ];

    let launched = false;
    for (const [cmd, ...args] of terminals) {
        if (spawnSync('which', [cmd]).status === 0) {
            spawn(cmd, [...args, `"${scriptPath}"`], { detached: true, stdio: 'ignore' }).unref();
            launched = true;
            break;
        }
    }

    if (!launched) {
        console.error(`Could not find a supported Linux terminal. Falling back to current.`);
        launchCurrent(worktreePath, agentCmd, agentArgs, bannerInfo, repoRoot);
    }
}

/**
 * Launch in a new Windows terminal.
 * Tries wt.exe (Windows Terminal) or falls back to cmd.exe.
 */
function launchWindowsAuto(worktreePath, agentCmd, agentArgs, bannerInfo, repoRoot) {
    if (repoRoot) {
        writeState(repoRoot, bannerInfo.slug, {
             backend: 'windows-auto',
             agent: bannerInfo.agent,
             status: 'launched',
        });
    }
    const scriptPath = writeLaunchScript(worktreePath, agentCmd, agentArgs, bannerInfo, repoRoot);

    const hasWt = spawnSync('where', ['wt']).status === 0;
    if (hasWt) {
        spawn('wt', ['-w', '0', 'nt', 'cmd', '/c', `"${scriptPath}"`], { detached: true, stdio: 'ignore' }).unref();
    } else {
        spawn('cmd', ['/c', 'start', 'cmd', '/c', `"${scriptPath}"`], { detached: true, stdio: 'ignore' }).unref();
    }
}
             backend: 'windows-auto',
             agent: bannerInfo.agent,
             status: 'launched',
        });
    }
    const scriptPath = writeLaunchScript(worktreePath, agentCmd, agentArgs, bannerInfo);

    const hasWt = spawnSync('where', ['wt']).status === 0;
    if (hasWt) {
        spawn('wt', ['-w', '0', 'nt', 'cmd', '/c', `"${scriptPath}"`], { detached: true, stdio: 'ignore' }).unref();
    } else {
        spawn('cmd', ['/c', 'start', 'cmd', '/c', `"${scriptPath}"`], { detached: true, stdio: 'ignore' }).unref();
    }
}
