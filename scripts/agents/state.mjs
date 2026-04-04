import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

/**
 * Read a state file for a slug.
 * @param {string} slug
 * @param {string} stateDir  - absolute path to agents/state/
 * @returns {object|null}
 */
export function readState(slug, stateDir) {
  const file = join(stateDir, `${slug}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write/update a state file.
 * @param {string} slug
 * @param {string} stateDir
 * @param {object} data
 */
export function writeState(slug, stateDir, data) {
  const file = join(stateDir, `${slug}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, file); // atomic on same filesystem
}

/**
 * List all known slugs from state files.
 * @param {string} stateDir
 * @returns {string[]}
 */
export function listSlugs(stateDir) {
  if (!existsSync(stateDir)) return [];
  return readdirSync(stateDir)
    .filter(f => f.endsWith('.json') && f !== 'registry.json')
    .map(f => f.slice(0, -5));
}

/**
 * List all state objects.
 * @param {string} stateDir
 * @returns {object[]}
 */
export function listStates(stateDir) {
  return listSlugs(stateDir)
    .map(slug => readState(slug, stateDir))
    .filter(Boolean);
}

/**
 * Remove a state file.
 * @param {string} slug
 * @param {string} stateDir
 */
export function removeState(slug, stateDir) {
  const file = join(stateDir, `${slug}.json`);
  if (existsSync(file)) unlinkSync(file);
}
