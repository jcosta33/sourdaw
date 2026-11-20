import { metricGoalStateCodec } from './metricGoalStateCodec';

/** Authority identities held by this batch; missing legacy state has no identity to match. */
export function readMetricCreativeAuthorityIds(serialized: string | null | undefined): string[] | undefined {
    if (serialized === null || serialized === undefined) {
        return undefined;
    }
    return (
        metricGoalStateCodec(serialized)?.authorities.flatMap((authority) =>
            authority.creativeAuthority === null ? [] : [authority.creativeAuthority.authorityId]
        ) ?? []
    );
}
