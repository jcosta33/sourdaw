import { musicalContentBindingIsCurrent, type captureMusicalContentBinding } from '#/modules/Project/useCases';

export function isMusicalReadStale(
    read: { current(): boolean } | null | undefined,
    unavailable: boolean,
    binding: ReturnType<typeof captureMusicalContentBinding> | undefined
): boolean {
    return Boolean((read && !read.current()) || (unavailable && binding && !musicalContentBindingIsCurrent(binding)));
}
