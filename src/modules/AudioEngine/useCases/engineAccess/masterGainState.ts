/**
 * Where the master fader stands, as the clamped linear amplitude the engines
 * were last told to use.
 *
 * Module state rather than a store read, because the fader's owner is another
 * module: Transport holds the position as project truth and calls into this one
 * to realise it. AudioEngine cannot read the Transport store — Transport
 * already imports these use cases, and the reverse edge would be a cycle — so
 * the value it applied is the only reading of the fader it is allowed to have.
 *
 * Seeded with `createWebAudioEngine`'s own default, so a session started before
 * the fader is ever moved states the level the Web Audio strips are already
 * playing at rather than unity.
 */
export const masterGainState: { gain: number } = { gain: 0.8 };
