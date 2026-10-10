import { captureProjectRootIdentity, DOC_PREFIX_ROOT, getCrdtDoc } from '#/modules/CrdtDocument/useCases';

import { sanitizeTrackSnapshot } from '../stores/trackStore';

/** Capture before optimistic publication; every deferred runtime effect rechecks this root. */
export function captureTrackRemovalRuntimeAuthority() {
    const rootIdentity = captureProjectRootIdentity();
    const hadRoot = getCrdtDoc(DOC_PREFIX_ROOT) !== undefined;
    const isCurrent = (): boolean =>
        captureProjectRootIdentity() === rootIdentity && (!hadRoot || getCrdtDoc(DOC_PREFIX_ROOT) !== undefined);
    const guard =
        <Result>(effect: () => Result): (() => Result | undefined) =>
        () => {
            if (!isCurrent()) {
                return undefined;
            }
            return effect();
        };
    const guardAbsent = <Result>(trackId: string, effect: () => Result): (() => Result | undefined) =>
        guard(() => {
            const document = getCrdtDoc(DOC_PREFIX_ROOT);
            if (document && sanitizeTrackSnapshot(document.tracks).tracks.some((track) => track.id === trackId)) {
                return undefined;
            }
            return effect();
        });
    return { isCurrent, guard, guardAbsent };
}
