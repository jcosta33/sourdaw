/**
 * Slug normalization utilities.
 */

const DEFAULT_MAX_LEN = 60;

/**
 * Convert a human-readable title to a URL-safe slug.
 * @param {string} title
 * @param {number} maxLen
 * @returns {string}
 */
export function toSlug(title, maxLen = DEFAULT_MAX_LEN) {
    if (!title || typeof title !== 'string') throw new Error('Title is required');

    let slug = title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // strip punctuation except hyphens
        .replace(/[\s]+/g, '-') // spaces → hyphens
        .replace(/-{2,}/g, '-') // collapse repeated hyphens
        .replace(/^-+|-+$/g, '') // strip leading/trailing hyphens
        .slice(0, maxLen)
        .replace(/-+$/g, ''); // strip trailing hyphens after slice

    if (!slug) throw new Error(`Title "${title}" produced an empty slug after normalization`);
    return slug;
}

/**
 * Derive all path/name artifacts from a slug.
 * @param {string} slug
 * @param {string} repoName  - basename of the repo directory
 * @param {object} config    - loaded config.json
 * @returns {object}
 */
export function deriveNames(slug, repoName, config) {
    const branch = `agent/${slug}`;
    const worktreePath = (config.worktreeDirPattern || '../{repoName}--{slug}')
        .replace('{repoName}', repoName)
        .replace('{slug}', slug);
    return {
        branch,
        worktreePath,
        taskFile: `.agents/tasks/${slug}.md`,
    };
}

/**
 * Find an available duplicate slug by appending -2, -3, ...
 * @param {string} baseSlug
 * @param {Set<string>} existingSlugs
 * @returns {string}
 */
export function nextDuplicateSlug(baseSlug, existingSlugs) {
    let n = 2;
    while (existingSlugs.has(`${baseSlug}-${n}`)) n++;
    return `${baseSlug}-${n}`;
}
