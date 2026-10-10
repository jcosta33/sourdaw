import { captureProjectRootIdentity, DOC_PREFIX_ROOT, getCrdtDoc } from '#/modules/CrdtDocument/useCases';

/** Capture before optimistic publication; every later removal effect rechecks this root. */
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
    return { isCurrent, guard };
}
