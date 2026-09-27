/**
 * The clip-placement compatibility rule lives with the clip use cases that
 * enforce it for every route (move, duplicate, paste); the timeline drop
 * re-exports it here so its own callers keep one stable import path.
 */
export { isClipDropCompatible } from '../clip/isClipDropCompatible';
