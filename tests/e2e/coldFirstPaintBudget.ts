/**
 * One-time bound for the dev server's cold module transform. Playwright's
 * `webServer.url` answers as soon as Vite serves the HTML shell, long before
 * the SPA and WASM module graph has compiled, so whichever test navigated
 * first used to absorb that compile inside its own first-paint allowance and
 * time out on cold CI hardware. This bound is paid once per run, outside every
 * test's observation window; the per-test first-paint bounds stay as they are
 * and keep measuring a warm module graph. The bound also has to absorb hosted
 * runner speed variance: on one Gate run, eleven shards warmed the dev-server
 * origin in 37–66 s, while a shard on a much slower runner (production build
 * about 3 min 50 s against about 45 s on a sibling) logged the boot-complete
 * marker at 120 s and had not shown the launch overlay at 180 s. A several-times
 * slower runner pays several times the cold cost, and raising the bound moves
 * no test's observation because it sits outside them.
 *
 * It lives apart from the warmup so a config whose whole-run limit must cover
 * it can derive that limit without loading the warmup's browser and app graph.
 */
export const COLD_FIRST_PAINT_TIMEOUT_MS = 300_000;
