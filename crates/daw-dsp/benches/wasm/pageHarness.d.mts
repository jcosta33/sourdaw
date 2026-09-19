/**
 * The page realm's side of the per-quantum cost harness.
 *
 * `index.html` installs `window.runQuantumCostTable`, whose rows are produced
 * by `quantumCostProcessor.js` from the recipes in `deviceRecipes.js`. All of
 * that is plain JavaScript the runner drives from Node, so the shapes that
 * cross the realm boundary are declared here and `run.mjs` reaches them with a
 * JSDoc type import.
 *
 * This module is declaration-only on purpose: the entry point it types is an
 * inline page script, so there is no `.mjs` file for it to sit beside.
 *
 * Nothing executes it, so it is deliberately outside the Grand Boule
 * measurement census and the release-proof tracked set: it cannot move a
 * measured figure, and pinning it would only claim provenance it does not need.
 */

/** The configuration the runner hands the page. */
export type QuantumCostTableConfig = {
    warmupQuanta: number;
    measureQuanta: number;
    segmentTargetMs: number;
    deviceIds: string[];
};

/**
 * One occupancy check — whether the instrument was still sounding when it was
 * asked, plus the reading it reported. Null while the page has not evaluated it.
 */
export type QuantumCostOccupancyCheck = {
    ok: boolean;
    detail: string;
};

/**
 * One device's raw row as the page posts it, carrying the main-thread wall
 * clock the page measures around the whole render.
 */
export type QuantumCostPageRow = {
    id: string;
    label: string;
    note: string;
    harnessFloorTicks: number[];
    warmVerify: QuantumCostOccupancyCheck | null;
    lateVerify: QuantumCostOccupancyCheck | null;
    warmupTotalTicks: number;
    zeroTickSamples: number;
    timedStartedAtMs: number;
    timedFinishedAtMs: number;
    mainThreadWallMs: number;
    segmentRates: number[];
    segmentIndex: number[];
    samplesTicks: number[];
};

/**
 * What the page's `runQuantumCostTable` resolves to. `browser` is filled in by
 * the runner from the Chrome build it launched, not by the page.
 */
export type QuantumCostPagePayload = {
    pageCrossOriginIsolated: boolean;
    userAgent: string;
    browser: string;
    results: QuantumCostPageRow[];
};

declare global {
    // Reached as `window.runQuantumCostTable` from the evaluate callback the
    // runner serializes into the page.
    var runQuantumCostTable: (config: QuantumCostTableConfig) => Promise<QuantumCostPagePayload>;
}
