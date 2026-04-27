import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Returns the path to the state file. Creates `.agents` dir if missing.
 * @param {string} repoRoot
 * @returns {string}
 */
function getStateFilePath(repoRoot) {
    const agentsDir = join(repoRoot, '.agents');
    if (!existsSync(agentsDir)) {
        mkdirSync(agentsDir, { recursive: true });
    }
    return join(agentsDir, 'state.json');
}

/**
 * Read the entire state registry.
 * @param {string} repoRoot
 * @returns {object} Map of slug -> state data
 */
export function readState(repoRoot) {
    const statePath = getStateFilePath(repoRoot);
    if (!existsSync(statePath)) return {};
    try {
        return JSON.parse(readFileSync(statePath, 'utf8'));
    } catch (e) {
        console.warn(`Warning: could not read state.json: ${e.message}`);
        return {};
    }
}

/**
 * Update the state for a specific agent slug.
 * @param {string} repoRoot
 * @param {string} slug
 * @param {object} data
 */
export function writeState(repoRoot, slug, data) {
    const statePath = getStateFilePath(repoRoot);
    const currentState = readState(repoRoot);
    currentState[slug] = {
        ...(currentState[slug] || {}),
        ...data,
        lastUpdated: new Date().toISOString(),
    };
    writeFileSync(statePath, JSON.stringify(currentState, null, 2), 'utf8');
}

/**
 * Remove an agent from the state registry.
 * @param {string} repoRoot
 * @param {string} slug
 */
export function removeState(repoRoot, slug) {
    const statePath = getStateFilePath(repoRoot);
    const currentState = readState(repoRoot);
    if (currentState[slug]) {
        delete currentState[slug];
        writeFileSync(statePath, JSON.stringify(currentState, null, 2), 'utf8');
    }
}

/**
 * Check if a PID is currently running.
 * @param {number} pid
 * @returns {boolean}
 */
export function isProcessRunning(pid) {
    if (!pid) return false;
    try {
        // kill(pid, 0) checks for existence without sending a signal
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}
