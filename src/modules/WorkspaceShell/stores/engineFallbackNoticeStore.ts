import { createStore } from '#/infra/store/createStore';

/**
 * Whether the engine-fallback banner was dismissed this session.
 *
 * Deliberately memory-backed, not persisted: the engine singleton re-decides
 * fallback mode on every page load (issue #3871), so a reload that still
 * cannot start audio must warn again rather than honour a past session's
 * dismissal.
 */
export const engineFallbackNoticeStore = createStore<boolean>({
    initialData: false,
});
