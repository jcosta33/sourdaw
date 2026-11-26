import { type SubgraphPrintInput } from './selectSubgraphPrintInput';

/** Whether two selections read the very same references, so they select the same input. */
export function subgraphPrintInputsMatch(left: SubgraphPrintInput, right: SubgraphPrintInput): boolean {
    return (
        left.targetTrackId === right.targetTrackId &&
        left.refs.length === right.refs.length &&
        left.refs.every((ref, index) => ref === right.refs[index])
    );
}
