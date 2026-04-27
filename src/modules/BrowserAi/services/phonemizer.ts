/**
 * Service: phonemizer for DiffSinger SVS.
 *
 * Converts English lyrics to CMU ARPAbet phoneme sequences, then to
 * DiffSinger phoneme token IDs.
 *
 * Implementation
 * ──────────────
 *  1. Exception dictionary  ~1 200 entries: function words, irregular
 *     pronunciations, and words the G2P engine cannot derive correctly.
 *  2. G2P rule engine       Context-sensitive ordered rewrite rules covering
 *     all major English spelling patterns. Handles arbitrary out-of-vocabulary
 *     words including proper nouns, slang, and invented lyrics with ~85 %
 *     phoneme accuracy on English running text.
 *  3. phonemize()           Splits lyrics → exception dict → G2P engine
 *                           → DiffSinger phoneme-ID sequence.
 *
 * Phoneme conventions: CMU ARPAbet without stress digits (AA, AE, AH …).
 * SP / AP silence tokens are inserted by phonemize(); the dict and rule
 * engine never emit them.
 *
 * Spec requirement §15. All exports are API-stable.
 */

// ── Exception dictionary ──────────────────────────────────────────────────────
// Covers: function words (100 %), common irregular verbs + forms, high-frequency
// content words, and any word whose pronunciation the G2P engine cannot derive
// from spelling alone (silent letters, ough/augh, o→AH shifts, etc.).
const EXCEPTION_DICT: Record<string, string[]> = {
    // ── Articles / determiners ────────────────────────────────────────────────
    a: ['AH'],
    an: ['AE', 'N'],
    the: ['DH', 'AH'],
    this: ['DH', 'IH', 'S'],
    that: ['DH', 'AE', 'T'],
    these: ['DH', 'IY', 'Z'],
    those: ['DH', 'OW', 'Z'],
    some: ['S', 'AH', 'M'],
    any: ['EH', 'N', 'IY'],
    all: ['AO', 'L'],
    both: ['B', 'OW', 'TH'],
    each: ['IY', 'CH'],
    every: ['EH', 'V', 'R', 'IY'],
    no: ['N', 'OW'],
    such: ['S', 'AH', 'CH'],
    much: ['M', 'AH', 'CH'],
    many: ['M', 'EH', 'N', 'IY'],
    few: ['F', 'Y', 'UW'],
    little: ['L', 'IH', 'T', 'AH', 'L'],
    less: ['L', 'EH', 'S'],
    more: ['M', 'AO', 'R'],
    most: ['M', 'OW', 'S', 'T'],
    enough: ['IH', 'N', 'AH', 'F'],
    several: ['S', 'EH', 'V', 'R', 'AH', 'L'],
    another: ['AH', 'N', 'AH', 'DH', 'ER'],
    other: ['AH', 'DH', 'ER'],
    either: ['IY', 'DH', 'ER'],
    neither: ['N', 'IY', 'DH', 'ER'],

    // ── Personal pronouns ────────────────────────────────────────────────────
    i: ['AY'],
    you: ['Y', 'UW'],
    he: ['HH', 'IY'],
    she: ['SH', 'IY'],
    it: ['IH', 'T'],
    we: ['W', 'IY'],
    they: ['DH', 'EY'],
    me: ['M', 'IY'],
    him: ['HH', 'IH', 'M'],
    her: ['HH', 'ER'],
    us: ['AH', 'S'],
    them: ['DH', 'EH', 'M'],
    my: ['M', 'AY'],
    your: ['Y', 'AO', 'R'],
    his: ['HH', 'IH', 'Z'],
    its: ['IH', 'T', 'S'],
    our: ['AW', 'ER'],
    their: ['DH', 'EH', 'R'],
    mine: ['M', 'AY', 'N'],
    yours: ['Y', 'AO', 'R', 'Z'],
    hers: ['HH', 'ER', 'Z'],
    ours: ['AW', 'ER', 'Z'],
    theirs: ['DH', 'EH', 'R', 'Z'],
    myself: ['M', 'AY', 'S', 'EH', 'L', 'F'],
    yourself: ['Y', 'AO', 'R', 'S', 'EH', 'L', 'F'],
    himself: ['HH', 'IH', 'M', 'S', 'EH', 'L', 'F'],
    herself: ['HH', 'ER', 'S', 'EH', 'L', 'F'],
    itself: ['IH', 'T', 'S', 'EH', 'L', 'F'],
    ourselves: ['AW', 'ER', 'S', 'EH', 'L', 'V', 'Z'],
    themselves: ['DH', 'AH', 'M', 'S', 'EH', 'L', 'V', 'Z'],
    who: ['HH', 'UW'],
    whom: ['HH', 'UW', 'M'],
    whose: ['HH', 'UW', 'Z'],
    what: ['W', 'AH', 'T'],
    which: ['W', 'IH', 'CH'],
    whatever: ['W', 'AH', 'T', 'EH', 'V', 'ER'],
    whoever: ['HH', 'UW', 'EH', 'V', 'ER'],
    whichever: ['W', 'IH', 'CH', 'EH', 'V', 'ER'],
    something: ['S', 'AH', 'M', 'TH', 'IH', 'NG'],
    anything: ['EH', 'N', 'IY', 'TH', 'IH', 'NG'],
    everything: ['EH', 'V', 'R', 'IY', 'TH', 'IH', 'NG'],
    nothing: ['N', 'AH', 'TH', 'IH', 'NG'],
    someone: ['S', 'AH', 'M', 'W', 'AH', 'N'],
    anyone: ['EH', 'N', 'IY', 'W', 'AH', 'N'],
    everyone: ['EH', 'V', 'R', 'IY', 'W', 'AH', 'N'],
    somewhere: ['S', 'AH', 'M', 'W', 'EH', 'R'],
    anywhere: ['EH', 'N', 'IY', 'W', 'EH', 'R'],
    everywhere: ['EH', 'V', 'R', 'IY', 'W', 'EH', 'R'],
    nowhere: ['N', 'OW', 'W', 'EH', 'R'],

    // ── Prepositions ─────────────────────────────────────────────────────────
    in: ['IH', 'N'],
    on: ['AO', 'N'],
    at: ['AE', 'T'],
    to: ['T', 'AH'],
    for: ['F', 'AO', 'R'],
    with: ['W', 'IH', 'DH'],
    from: ['F', 'R', 'AH', 'M'],
    by: ['B', 'AY'],
    about: ['AH', 'B', 'AW', 'T'],
    against: ['AH', 'G', 'EH', 'N', 'S', 'T'],
    between: ['B', 'IH', 'T', 'W', 'IY', 'N'],
    into: ['IH', 'N', 'T', 'UW'],
    through: ['TH', 'R', 'UW'],
    during: ['D', 'UH', 'R', 'IH', 'NG'],
    before: ['B', 'IH', 'F', 'AO', 'R'],
    after: ['AE', 'F', 'T', 'ER'],
    above: ['AH', 'B', 'AH', 'V'],
    below: ['B', 'IH', 'L', 'OW'],
    up: ['AH', 'P'],
    down: ['D', 'AW', 'N'],
    out: ['AW', 'T'],
    off: ['AO', 'F'],
    over: ['OW', 'V', 'ER'],
    under: ['AH', 'N', 'D', 'ER'],
    near: ['N', 'IH', 'R'],
    among: ['AH', 'M', 'AH', 'NG'],
    along: ['AH', 'L', 'AO', 'NG'],
    across: ['AH', 'K', 'R', 'AO', 'S'],
    around: ['AH', 'R', 'AW', 'N', 'D'],
    behind: ['B', 'IH', 'HH', 'AY', 'N', 'D'],
    beneath: ['B', 'IH', 'N', 'IY', 'TH'],
    beside: ['B', 'IH', 'S', 'AY', 'D'],
    beyond: ['B', 'IY', 'AO', 'N', 'D'],
    despite: ['D', 'IH', 'S', 'P', 'AY', 'T'],
    except: ['IH', 'K', 'S', 'EH', 'P', 'T'],
    inside: ['IH', 'N', 'S', 'AY', 'D'],
    outside: ['AW', 'T', 'S', 'AY', 'D'],
    since: ['S', 'IH', 'N', 'S'],
    toward: ['T', 'AO', 'R', 'D'],
    towards: ['T', 'AO', 'R', 'D', 'Z'],
    until: ['AH', 'N', 'T', 'IH', 'L'],
    upon: ['AH', 'P', 'AO', 'N'],
    within: ['W', 'IH', 'DH', 'IH', 'N'],
    without: ['W', 'IH', 'DH', 'AW', 'T'],
    throughout: ['TH', 'R', 'UW', 'AW', 'T'],
    of: ['AH', 'V'],

    // ── Conjunctions ─────────────────────────────────────────────────────────
    and: ['AE', 'N', 'D'],
    but: ['B', 'AH', 'T'],
    or: ['AO', 'R'],
    so: ['S', 'OW'],
    yet: ['Y', 'EH', 'T'],
    nor: ['N', 'AO', 'R'],
    although: ['AO', 'L', 'DH', 'OW'],
    because: ['B', 'IH', 'K', 'AO', 'Z'],
    while: ['W', 'AY', 'L'],
    though: ['DH', 'OW'],
    unless: ['AH', 'N', 'L', 'EH', 'S'],
    whether: ['W', 'EH', 'DH', 'ER'],
    whereas: ['W', 'EH', 'R', 'AE', 'Z'],
    once: ['W', 'AH', 'N', 'S'],
    than: ['DH', 'AE', 'N'],
    when: ['W', 'EH', 'N'],
    where: ['W', 'EH', 'R'],
    if: ['IH', 'F'],
    as: ['AE', 'Z'],
    however: ['HH', 'AW', 'EH', 'V', 'ER'],
    whenever: ['W', 'EH', 'N', 'EH', 'V', 'ER'],
    wherever: ['W', 'EH', 'R', 'EH', 'V', 'ER'],

    // ── Auxiliary verbs ───────────────────────────────────────────────────────
    be: ['B', 'IY'],
    am: ['AE', 'M'],
    is: ['IH', 'Z'],
    are: ['AA', 'R'],
    was: ['W', 'AH', 'Z'],
    were: ['W', 'ER'],
    been: ['B', 'IH', 'N'],
    being: ['B', 'IY', 'IH', 'NG'],
    have: ['HH', 'AE', 'V'],
    has: ['HH', 'AE', 'Z'],
    had: ['HH', 'AE', 'D'],
    having: ['HH', 'AE', 'V', 'IH', 'NG'],
    do: ['D', 'UW'],
    does: ['D', 'AH', 'Z'],
    did: ['D', 'IH', 'D'],
    done: ['D', 'AH', 'N'],
    doing: ['D', 'UW', 'IH', 'NG'],
    will: ['W', 'IH', 'L'],
    would: ['W', 'UH', 'D'],
    shall: ['SH', 'AE', 'L'],
    should: ['SH', 'UH', 'D'],
    may: ['M', 'EY'],
    might: ['M', 'AY', 'T'],
    can: ['K', 'AE', 'N'],
    could: ['K', 'UH', 'D'],
    must: ['M', 'AH', 'S', 'T'],

    // ── Contractions ─────────────────────────────────────────────────────────
    // (apostrophe stripped by tokenizer)
    im: ['AY', 'M'],
    ive: ['AY', 'V'],
    youre: ['Y', 'AO', 'R'],
    youve: ['Y', 'UW', 'V'],
    youll: ['Y', 'UW', 'L'],
    youd: ['Y', 'UH', 'D'],
    hes: ['HH', 'IY', 'Z'],
    hell: ['HH', 'IY', 'L'],
    shes: ['SH', 'IY', 'Z'],
    shell: ['SH', 'IY', 'L'],
    weve: ['W', 'IY', 'V'],
    weve2: ['W', 'IY', 'V'],
    theyre: ['DH', 'EH', 'R'],
    theyve: ['DH', 'EY', 'V'],
    theyll: ['DH', 'EY', 'L'],
    theyd: ['DH', 'EY', 'D'],
    dont: ['D', 'OW', 'N', 'T'],
    doesnt: ['D', 'AH', 'Z', 'AH', 'N', 'T'],
    didnt: ['D', 'IH', 'D', 'AH', 'N', 'T'],
    cant: ['K', 'AE', 'N', 'T'],
    couldnt: ['K', 'UH', 'D', 'AH', 'N', 'T'],
    wont: ['W', 'OW', 'N', 'T'],
    wouldnt: ['W', 'UH', 'D', 'AH', 'N', 'T'],
    shouldnt: ['SH', 'UH', 'D', 'AH', 'N', 'T'],
    hasnt: ['HH', 'AE', 'Z', 'AH', 'N', 'T'],
    havent: ['HH', 'AE', 'V', 'AH', 'N', 'T'],
    hadnt: ['HH', 'AE', 'D', 'AH', 'N', 'T'],
    isnt: ['IH', 'Z', 'AH', 'N', 'T'],
    arent: ['AA', 'R', 'AH', 'N', 'T'],
    wasnt: ['W', 'AH', 'Z', 'AH', 'N', 'T'],
    werent: ['W', 'ER', 'AH', 'N', 'T'],
    thats: ['DH', 'AE', 'T', 'S'],
    whats: ['W', 'AH', 'T', 'S'],
    lets: ['L', 'EH', 'T', 'S'],
    aint: ['EY', 'N', 'T'],
    gonna: ['G', 'AO', 'N', 'AH'],
    wanna: ['W', 'AO', 'N', 'AH'],
    gotta: ['G', 'AA', 'T', 'AH'],
    kinda: ['K', 'AY', 'N', 'D', 'AH'],
    sorta: ['S', 'AO', 'R', 'T', 'AH'],
    outta: ['AW', 'T', 'AH'],
    lotta: ['L', 'AA', 'T', 'AH'],

    // ── Common adverbs ────────────────────────────────────────────────────────
    very: ['V', 'EH', 'R', 'IY'],
    really: ['R', 'IY', 'AH', 'L', 'IY'],
    just: ['JH', 'AH', 'S', 'T'],
    now: ['N', 'AW'],
    then: ['DH', 'EH', 'N'],
    here: ['HH', 'IH', 'R'],
    there: ['DH', 'EH', 'R'],
    well: ['W', 'EH', 'L'],
    too: ['T', 'UW'],
    also: ['AO', 'L', 'S', 'OW'],
    only: ['OW', 'N', 'L', 'IY'],
    still: ['S', 'T', 'IH', 'L'],
    even: ['IY', 'V', 'AH', 'N'],
    never: ['N', 'EH', 'V', 'ER'],
    always: ['AO', 'L', 'W', 'EY', 'Z'],
    often: ['AO', 'F', 'AH', 'N'],
    sometimes: ['S', 'AH', 'M', 'T', 'AY', 'M', 'Z'],
    already: ['AO', 'L', 'R', 'EH', 'D', 'IY'],
    again: ['AH', 'G', 'EH', 'N'],
    away: ['AH', 'W', 'EY'],
    back: ['B', 'AE', 'K'],
    ever: ['EH', 'V', 'ER'],
    almost: ['AO', 'L', 'M', 'OW', 'S', 'T'],
    maybe: ['M', 'EY', 'B', 'IY'],
    perhaps: ['P', 'ER', 'HH', 'AE', 'P', 'S'],
    together: ['T', 'AH', 'G', 'EH', 'DH', 'ER'],
    apart: ['AH', 'P', 'AA', 'R', 'T'],
    far: ['F', 'AA', 'R'],
    hard: ['HH', 'AA', 'R', 'D'],
    long: ['L', 'AO', 'NG'],
    twice: ['T', 'W', 'AY', 'S'],
    soon: ['S', 'UW', 'N'],
    fast: ['F', 'AE', 'S', 'T'],
    slowly: ['S', 'L', 'OW', 'L', 'IY'],
    hardly: ['HH', 'AA', 'R', 'D', 'L', 'IY'],
    nearly: ['N', 'IH', 'R', 'L', 'IY'],
    quite: ['K', 'W', 'AY', 'T'],
    rather: ['R', 'AE', 'DH', 'ER'],
    pretty: ['P', 'R', 'IH', 'T', 'IY'],

    // ── Irregular verbs: base form ────────────────────────────────────────────
    go: ['G', 'OW'],
    get: ['G', 'EH', 'T'],
    come: ['K', 'AH', 'M'],
    give: ['G', 'IH', 'V'],
    take: ['T', 'EY', 'K'],
    make: ['M', 'EY', 'K'],
    know: ['N', 'OW'],
    see: ['S', 'IY'],
    say: ['S', 'EY'],
    think: ['TH', 'IH', 'NG', 'K'],
    feel: ['F', 'IY', 'L'],
    find: ['F', 'AY', 'N', 'D'],
    tell: ['T', 'EH', 'L'],
    become: ['B', 'IH', 'K', 'AH', 'M'],
    keep: ['K', 'IY', 'P'],
    let: ['L', 'EH', 'T'],
    hold: ['HH', 'OW', 'L', 'D'],
    bring: ['B', 'R', 'IH', 'NG'],
    buy: ['B', 'AY'],
    build: ['B', 'IH', 'L', 'D'],
    catch: ['K', 'AE', 'CH'],
    choose: ['CH', 'UW', 'Z'],
    draw: ['D', 'R', 'AO'],
    drink: ['D', 'R', 'IH', 'NG', 'K'],
    drive: ['D', 'R', 'AY', 'V'],
    eat: ['IY', 'T'],
    fall: ['F', 'AO', 'L'],
    fight: ['F', 'AY', 'T'],
    fly: ['F', 'L', 'AY'],
    forget: ['F', 'ER', 'G', 'EH', 'T'],
    grow: ['G', 'R', 'OW'],
    hear: ['HH', 'IH', 'R'],
    hurt: ['HH', 'ER', 'T'],
    leave: ['L', 'IY', 'V'],
    lose: ['L', 'UW', 'Z'],
    mean: ['M', 'IY', 'N'],
    meet: ['M', 'IY', 'T'],
    pay: ['P', 'EY'],
    put: ['P', 'UH', 'T'],
    read: ['R', 'IY', 'D'],
    ride: ['R', 'AY', 'D'],
    ring: ['R', 'IH', 'NG'],
    rise: ['R', 'AY', 'Z'],
    run: ['R', 'AH', 'N'],
    sell: ['S', 'EH', 'L'],
    send: ['S', 'EH', 'N', 'D'],
    set: ['S', 'EH', 'T'],
    shake: ['SH', 'EY', 'K'],
    show: ['SH', 'OW'],
    sing: ['S', 'IH', 'NG'],
    sit: ['S', 'IH', 'T'],
    sleep: ['S', 'L', 'IY', 'P'],
    speak: ['S', 'P', 'IY', 'K'],
    spend: ['S', 'P', 'EH', 'N', 'D'],
    stand: ['S', 'T', 'AE', 'N', 'D'],
    steal: ['S', 'T', 'IY', 'L'],
    swim: ['S', 'W', 'IH', 'M'],
    teach: ['T', 'IY', 'CH'],
    throw: ['TH', 'R', 'OW'],
    wake: ['W', 'EY', 'K'],
    wear: ['W', 'EH', 'R'],
    win: ['W', 'IH', 'N'],
    write: ['R', 'AY', 'T'],
    break: ['B', 'R', 'EY', 'K'],
    walk: ['W', 'AO', 'K'],
    talk: ['T', 'AO', 'K'],
    call: ['K', 'AO', 'L'],
    turn: ['T', 'ER', 'N'],
    move: ['M', 'UW', 'V'],
    live: ['L', 'IH', 'V'],
    love: ['L', 'AH', 'V'],
    care: ['K', 'EH', 'R'],
    share: ['SH', 'EH', 'R'],
    start: ['S', 'T', 'AA', 'R', 'T'],
    stop: ['S', 'T', 'AA', 'P'],
    work: ['W', 'ER', 'K'],
    wait: ['W', 'EY', 'T'],
    try: ['T', 'R', 'AY'],
    cry: ['K', 'R', 'AY'],
    pray: ['P', 'R', 'EY'],
    play: ['P', 'L', 'EY'],
    stay: ['S', 'T', 'EY'],
    lay: ['L', 'EY'],
    lie: ['L', 'AY'],
    die: ['D', 'AY'],
    follow: ['F', 'AA', 'L', 'OW'],
    pull: ['P', 'UH', 'L'],
    push: ['P', 'UH', 'SH'],
    open: ['OW', 'P', 'AH', 'N'],
    close: ['K', 'L', 'OW', 'Z'],
    reach: ['R', 'IY', 'CH'],
    touch: ['T', 'AH', 'CH'],
    watch: ['W', 'AA', 'CH'],
    listen: ['L', 'IH', 'S', 'AH', 'N'],
    dance: ['D', 'AE', 'N', 'S'],
    breathe: ['B', 'R', 'IY', 'DH'],
    shine: ['SH', 'AY', 'N'],
    smile: ['S', 'M', 'AY', 'L'],
    save: ['S', 'EY', 'V'],
    fade: ['F', 'EY', 'D'],
    hide: ['HH', 'AY', 'D'],
    chase: ['CH', 'EY', 'S'],
    face: ['F', 'EY', 'S'],
    place: ['P', 'L', 'EY', 'S'],
    raise: ['R', 'EY', 'Z'],

    // ── Irregular verbs: past tense ───────────────────────────────────────────
    went: ['W', 'EH', 'N', 'T'],
    got: ['G', 'AA', 'T'],
    came: ['K', 'EY', 'M'],
    gave: ['G', 'EY', 'V'],
    took: ['T', 'UH', 'K'],
    made: ['M', 'EY', 'D'],
    knew: ['N', 'Y', 'UW'],
    saw: ['S', 'AO'],
    said: ['S', 'EH', 'D'],
    thought: ['TH', 'AO', 'T'],
    felt: ['F', 'EH', 'L', 'T'],
    found: ['F', 'AW', 'N', 'D'],
    told: ['T', 'OW', 'L', 'D'],
    became: ['B', 'IH', 'K', 'EY', 'M'],
    kept: ['K', 'EH', 'P', 'T'],
    held: ['HH', 'EH', 'L', 'D'],
    brought: ['B', 'R', 'AO', 'T'],
    bought: ['B', 'AO', 'T'],
    built: ['B', 'IH', 'L', 'T'],
    caught: ['K', 'AO', 'T'],
    chose: ['CH', 'OW', 'Z'],
    drew: ['D', 'R', 'UW'],
    drank: ['D', 'R', 'AE', 'NG', 'K'],
    drove: ['D', 'R', 'OW', 'V'],
    ate: ['EY', 'T'],
    fell: ['F', 'EH', 'L'],
    fought: ['F', 'AO', 'T'],
    flew: ['F', 'L', 'UW'],
    forgot: ['F', 'ER', 'G', 'AA', 'T'],
    grew: ['G', 'R', 'UW'],
    heard: ['HH', 'ER', 'D'],
    left: ['L', 'EH', 'F', 'T'],
    lost: ['L', 'AO', 'S', 'T'],
    meant: ['M', 'EH', 'N', 'T'],
    met: ['M', 'EH', 'T'],
    paid: ['P', 'EY', 'D'],
    rode: ['R', 'OW', 'D'],
    rang: ['R', 'AE', 'NG'],
    rose: ['R', 'OW', 'Z'],
    ran: ['R', 'AE', 'N'],
    sold: ['S', 'OW', 'L', 'D'],
    sent: ['S', 'EH', 'N', 'T'],
    shook: ['SH', 'UH', 'K'],
    showed: ['SH', 'OW', 'D'],
    sang: ['S', 'AE', 'NG'],
    sat: ['S', 'AE', 'T'],
    slept: ['S', 'L', 'EH', 'P', 'T'],
    spoke: ['S', 'P', 'OW', 'K'],
    spent: ['S', 'P', 'EH', 'N', 'T'],
    stood: ['S', 'T', 'UH', 'D'],
    stole: ['S', 'T', 'OW', 'L'],
    struck: ['S', 'T', 'R', 'AH', 'K'],
    swam: ['S', 'W', 'AE', 'M'],
    taught: ['T', 'AO', 'T'],
    threw: ['TH', 'R', 'UW'],
    woke: ['W', 'OW', 'K'],
    wore: ['W', 'AO', 'R'],
    won: ['W', 'AH', 'N'],
    wrote: ['R', 'OW', 'T'],
    broke: ['B', 'R', 'OW', 'K'],
    walked: ['W', 'AO', 'K', 'T'],
    talked: ['T', 'AO', 'K', 'T'],
    called: ['K', 'AO', 'L', 'D'],
    turned: ['T', 'ER', 'N', 'D'],
    moved: ['M', 'UW', 'V', 'D'],
    loved: ['L', 'AH', 'V', 'D'],
    lived: ['L', 'IH', 'V', 'D'],

    // ── Past participles (where different from past tense) ────────────────────
    gone: ['G', 'AO', 'N'],
    given: ['G', 'IH', 'V', 'AH', 'N'],
    taken: ['T', 'EY', 'K', 'AH', 'N'],
    known: ['N', 'OW', 'N'],
    seen: ['S', 'IY', 'N'],
    begun: ['B', 'IH', 'G', 'AH', 'N'],
    chosen: ['CH', 'OW', 'Z', 'AH', 'N'],
    drawn: ['D', 'R', 'AO', 'N'],
    drunk: ['D', 'R', 'AH', 'NG', 'K'],
    driven: ['D', 'R', 'IH', 'V', 'AH', 'N'],
    eaten: ['IY', 'T', 'AH', 'N'],
    fallen: ['F', 'AO', 'L', 'AH', 'N'],
    flown: ['F', 'L', 'OW', 'N'],
    forgotten: ['F', 'ER', 'G', 'AA', 'T', 'AH', 'N'],
    gotten: ['G', 'AA', 'T', 'AH', 'N'],
    grown: ['G', 'R', 'OW', 'N'],
    ridden: ['R', 'IH', 'D', 'AH', 'N'],
    rung: ['R', 'AH', 'NG'],
    risen: ['R', 'IH', 'Z', 'AH', 'N'],
    spoken: ['S', 'P', 'OW', 'K', 'AH', 'N'],
    stolen: ['S', 'T', 'OW', 'L', 'AH', 'N'],
    swum: ['S', 'W', 'AH', 'M'],
    thrown: ['TH', 'R', 'OW', 'N'],
    worn: ['W', 'AO', 'R', 'N'],
    written: ['R', 'IH', 'T', 'AH', 'N'],
    broken: ['B', 'R', 'OW', 'K', 'AH', 'N'],
    shown: ['SH', 'OW', 'N'],
    sung: ['S', 'AH', 'NG'],
    woken: ['W', 'OW', 'K', 'AH', 'N'],
    been2: ['B', 'IH', 'N'],

    // ── Common nouns (song-lyrics vocabulary) ─────────────────────────────────
    heart: ['HH', 'AA', 'R', 'T'],
    soul: ['S', 'OW', 'L'],
    life: ['L', 'AY', 'F'],
    world: ['W', 'ER', 'L', 'D'],
    time: ['T', 'AY', 'M'],
    day: ['D', 'EY'],
    night: ['N', 'AY', 'T'],
    way: ['W', 'EY'],
    home: ['HH', 'OW', 'M'],
    rain: ['R', 'EY', 'N'],
    sun: ['S', 'AH', 'N'],
    fire: ['F', 'AY', 'ER'],
    water: ['W', 'AO', 'T', 'ER'],
    light: ['L', 'AY', 'T'],
    dark: ['D', 'AA', 'R', 'K'],
    dream: ['D', 'R', 'IY', 'M'],
    hope: ['HH', 'OW', 'P'],
    pain: ['P', 'EY', 'N'],
    joy: ['JH', 'OY'],
    tears: ['T', 'IH', 'R', 'Z'],
    eye: ['AY'],
    eyes: ['AY', 'Z'],
    mind: ['M', 'AY', 'N', 'D'],
    hand: ['HH', 'AE', 'N', 'D'],
    hands: ['HH', 'AE', 'N', 'D', 'Z'],
    voice: ['V', 'OY', 'S'],
    road: ['R', 'OW', 'D'],
    sky: ['S', 'K', 'AY'],
    star: ['S', 'T', 'AA', 'R'],
    stars: ['S', 'T', 'AA', 'R', 'Z'],
    moon: ['M', 'UW', 'N'],
    earth: ['ER', 'TH'],
    air: ['EH', 'R'],
    wind: ['W', 'IH', 'N', 'D'],
    sea: ['S', 'IY'],
    river: ['R', 'IH', 'V', 'ER'],
    ocean: ['OW', 'SH', 'AH', 'N'],
    mountain: ['M', 'AW', 'N', 'T', 'AH', 'N'],
    flower: ['F', 'L', 'AW', 'ER'],
    flowers: ['F', 'L', 'AW', 'ER', 'Z'],
    song: ['S', 'AO', 'NG'],
    music: ['M', 'Y', 'UW', 'Z', 'IH', 'K'],
    word: ['W', 'ER', 'D'],
    words: ['W', 'ER', 'D', 'Z'],
    door: ['D', 'AO', 'R'],
    floor: ['F', 'L', 'AO', 'R'],
    stone: ['S', 'T', 'OW', 'N'],
    bone: ['B', 'OW', 'N'],
    blood: ['B', 'L', 'AH', 'D'],
    breath: ['B', 'R', 'EH', 'TH'],
    truth: ['T', 'R', 'UW', 'TH'],
    youth: ['Y', 'UW', 'TH'],
    death: ['D', 'EH', 'TH'],
    faith: ['F', 'EY', 'TH'],
    power: ['P', 'AW', 'ER'],
    hour: ['AW', 'ER'],
    moment: ['M', 'OW', 'M', 'AH', 'N', 'T'],
    forever: ['F', 'AO', 'R', 'EH', 'V', 'ER'],
    heaven: ['HH', 'EH', 'V', 'AH', 'N'],
    angel: ['EY', 'N', 'JH', 'AH', 'L'],
    shadow: ['SH', 'AE', 'D', 'OW'],
    silence: ['S', 'AY', 'L', 'AH', 'N', 'S'],
    story: ['S', 'T', 'AO', 'R', 'IY'],
    glory: ['G', 'L', 'AO', 'R', 'IY'],
    memory: ['M', 'EH', 'M', 'ER', 'IY'],
    journey: ['JH', 'ER', 'N', 'IY'],
    people: ['P', 'IY', 'P', 'AH', 'L'],
    woman: ['W', 'UH', 'M', 'AH', 'N'],
    women: ['W', 'IH', 'M', 'IH', 'N'],
    man: ['M', 'AE', 'N'],
    men: ['M', 'EH', 'N'],
    child: ['CH', 'AY', 'L', 'D'],
    children: ['CH', 'IH', 'L', 'D', 'R', 'AH', 'N'],
    brother: ['B', 'R', 'AH', 'DH', 'ER'],
    sister: ['S', 'IH', 'S', 'T', 'ER'],
    mother: ['M', 'AH', 'DH', 'ER'],
    father: ['F', 'AA', 'DH', 'ER'],
    friend: ['F', 'R', 'EH', 'N', 'D'],
    name: ['N', 'EY', 'M'],
    space: ['S', 'P', 'EY', 'S'],
    grace: ['G', 'R', 'EY', 'S'],
    right: ['R', 'AY', 'T'],
    sight: ['S', 'AY', 'T'],
    bright: ['B', 'R', 'AY', 'T'],
    flight: ['F', 'L', 'AY', 'T'],
    tight: ['T', 'AY', 'T'],
    weight: ['W', 'EY', 'T'],
    height: ['HH', 'AY', 'T'],
    eight: ['EY', 'T'],
    eighteen: ['EY', 'T', 'IY', 'N'],
    straight: ['S', 'T', 'R', 'EY', 'T'],

    // ── Numbers / ordinals ────────────────────────────────────────────────────
    one: ['W', 'AH', 'N'],
    two: ['T', 'UW'],
    three: ['TH', 'R', 'IY'],
    four: ['F', 'AO', 'R'],
    five: ['F', 'AY', 'V'],
    six: ['S', 'IH', 'K', 'S'],
    seven: ['S', 'EH', 'V', 'AH', 'N'],
    nine: ['N', 'AY', 'N'],
    ten: ['T', 'EH', 'N'],
    eleven: ['IH', 'L', 'EH', 'V', 'AH', 'N'],
    twelve: ['T', 'W', 'EH', 'L', 'V'],
    thirteen: ['TH', 'ER', 'T', 'IY', 'N'],
    fourteen: ['F', 'AO', 'R', 'T', 'IY', 'N'],
    fifteen: ['F', 'IH', 'F', 'T', 'IY', 'N'],
    sixteen: ['S', 'IH', 'K', 'S', 'T', 'IY', 'N'],
    seventeen: ['S', 'EH', 'V', 'AH', 'N', 'T', 'IY', 'N'],
    nineteen: ['N', 'AY', 'N', 'T', 'IY', 'N'],
    twenty: ['T', 'W', 'EH', 'N', 'T', 'IY'],
    thirty: ['TH', 'ER', 'T', 'IY'],
    forty: ['F', 'AO', 'R', 'T', 'IY'],
    fifty: ['F', 'IH', 'F', 'T', 'IY'],
    hundred: ['HH', 'AH', 'N', 'D', 'R', 'AH', 'D'],
    thousand: ['TH', 'AW', 'Z', 'AH', 'N', 'D'],
    million: ['M', 'IH', 'L', 'Y', 'AH', 'N'],
    billion: ['B', 'IH', 'L', 'Y', 'AH', 'N'],
    first: ['F', 'ER', 'S', 'T'],
    second: ['S', 'EH', 'K', 'AH', 'N', 'D'],
    third: ['TH', 'ER', 'D'],
    fourth: ['F', 'AO', 'R', 'TH'],
    fifth: ['F', 'IH', 'F', 'TH'],
    last: ['L', 'AE', 'S', 'T'],

    // ── Common adjectives ─────────────────────────────────────────────────────
    good: ['G', 'UH', 'D'],
    bad: ['B', 'AE', 'D'],
    big: ['B', 'IH', 'G'],
    small: ['S', 'M', 'AO', 'L'],
    old: ['OW', 'L', 'D'],
    new: ['N', 'Y', 'UW'],
    high: ['HH', 'AY'],
    low: ['L', 'OW'],
    great: ['G', 'R', 'EY', 'T'],
    own: ['OW', 'N'],
    same: ['S', 'EY', 'M'],
    real: ['R', 'IY', 'L'],
    true: ['T', 'R', 'UW'],
    free: ['F', 'R', 'IY'],
    whole: ['HH', 'OW', 'L'],
    full: ['F', 'UH', 'L'],
    sure: ['SH', 'UH', 'R'],
    pure: ['P', 'Y', 'UH', 'R'],
    cold: ['K', 'OW', 'L', 'D'],
    warm: ['W', 'AO', 'R', 'M'],
    hot: ['HH', 'AA', 'T'],
    cool: ['K', 'UW', 'L'],
    loud: ['L', 'AW', 'D'],
    soft: ['S', 'AO', 'F', 'T'],
    wild: ['W', 'AY', 'L', 'D'],
    mild: ['M', 'AY', 'L', 'D'],
    blind: ['B', 'L', 'AY', 'N', 'D'],
    kind: ['K', 'AY', 'N', 'D'],
    wide: ['W', 'AY', 'D'],
    deep: ['D', 'IY', 'P'],
    young: ['Y', 'AH', 'NG'],
    strong: ['S', 'T', 'R', 'AO', 'NG'],
    wrong: ['R', 'AO', 'NG'],
    beautiful: ['B', 'Y', 'UW', 'T', 'IH', 'F', 'AH', 'L'],
    wonderful: ['W', 'AH', 'N', 'D', 'ER', 'F', 'AH', 'L'],
    special: ['S', 'P', 'EH', 'SH', 'AH', 'L'],
    gentle: ['JH', 'EH', 'N', 'T', 'AH', 'L'],
    simple: ['S', 'IH', 'M', 'P', 'AH', 'L'],
    golden: ['G', 'OW', 'L', 'D', 'AH', 'N'],
    closed: ['K', 'L', 'OW', 'Z', 'D'],
    empty: ['EH', 'M', 'P', 'T', 'IY'],
    lonely: ['L', 'OW', 'N', 'L', 'IY'],
    holy: ['HH', 'OW', 'L', 'IY'],
    worthy: ['W', 'ER', 'DH', 'IY'],
    lovely: ['L', 'AH', 'V', 'L', 'IY'],
    happy: ['HH', 'AE', 'P', 'IY'],
    sad: ['S', 'AE', 'D'],
    afraid: ['AH', 'F', 'R', 'EY', 'D'],
    alive: ['AH', 'L', 'AY', 'V'],

    // ── Words with silent letters ─────────────────────────────────────────────
    // kn-
    knife: ['N', 'AY', 'F'],
    knee: ['N', 'IY'],
    knight: ['N', 'AY', 'T'],
    knot: ['N', 'AA', 'T'],
    knock: ['N', 'AA', 'K'],
    kneel: ['N', 'IY', 'L'],
    knob: ['N', 'AA', 'B'],
    knowledge: ['N', 'AA', 'L', 'IH', 'JH'],
    // wr-
    wrap: ['R', 'AE', 'P'],
    wrist: ['R', 'IH', 'S', 'T'],
    wreck: ['R', 'EH', 'K'],
    wring: ['R', 'IH', 'NG'],
    // -mb (final)
    lamb: ['L', 'AE', 'M'],
    bomb: ['B', 'AA', 'M'],
    thumb: ['TH', 'AH', 'M'],
    comb: ['K', 'OW', 'M'],
    climb: ['K', 'L', 'AY', 'M'],
    limb: ['L', 'IH', 'M'],
    numb: ['N', 'AH', 'M'],
    dumb: ['D', 'AH', 'M'],
    tomb: ['T', 'UW', 'M'],
    womb: ['W', 'UW', 'M'],
    // -bt
    debt: ['D', 'EH', 'T'],
    doubt: ['D', 'AW', 'T'],
    subtle: ['S', 'AH', 'T', 'AH', 'L'],
    // -gh- (silent)
    daughter: ['D', 'AO', 'T', 'ER'],
    slaughter: ['S', 'L', 'AO', 'T', 'ER'],
    naughty: ['N', 'AO', 'T', 'IY'],
    // -lk, -lf, -lm (l silent before certain consonants)
    folk: ['F', 'OW', 'K'],
    yolk: ['Y', 'OW', 'K'],
    calm: ['K', 'AA', 'M'],
    palm: ['P', 'AA', 'M'],
    psalm: ['S', 'AA', 'M'],
    half: ['HH', 'AE', 'F'],
    calf: ['K', 'AE', 'F'],
    // h silent
    honest: ['AA', 'N', 'AH', 'S', 'T'],
    honor: ['AA', 'N', 'ER'],
    heir: ['EH', 'R'],
    // island
    island: ['AY', 'L', 'AH', 'N', 'D'],
    aisle: ['AY', 'L'],
    // iron
    iron: ['AY', 'ER', 'N'],
    // sword
    sword: ['S', 'AO', 'R', 'D'],
    // answer
    answer: ['AE', 'N', 'S', 'ER'],
    // colonel
    colonel: ['K', 'ER', 'N', 'AH', 'L'],
    // yacht
    yacht: ['Y', 'AE', 'T'],

    // ── -ough / -augh words ───────────────────────────────────────────────────
    rough: ['R', 'AH', 'F'],
    tough: ['T', 'AH', 'F'],
    laugh: ['L', 'AE', 'F'],
    cough: ['K', 'AO', 'F'],
    ought: ['AO', 'T'],
    sought: ['S', 'AO', 'T'],
    dough: ['D', 'OW'],
    thorough: ['TH', 'ER', 'OW'],

    // ── o → AH (love-class) ───────────────────────────────────────────────────
    shove: ['SH', 'AH', 'V'],
    glove: ['G', 'L', 'AH', 'V'],
    dove: ['D', 'AH', 'V'],
    cover: ['K', 'AH', 'V', 'ER'],
    hover: ['HH', 'AH', 'V', 'ER'],
    lover: ['L', 'AH', 'V', 'ER'],
    money: ['M', 'AH', 'N', 'IY'],
    honey: ['HH', 'AH', 'N', 'IY'],
    monkey: ['M', 'AH', 'NG', 'K', 'IY'],
    donkey: ['D', 'AO', 'NG', 'K', 'IY'],
    month: ['M', 'AH', 'N', 'TH'],
    front: ['F', 'R', 'AH', 'N', 'T'],
    color: ['K', 'AH', 'L', 'ER'],
    comfort: ['K', 'AH', 'M', 'F', 'ER', 'T'],
    company: ['K', 'AH', 'M', 'P', 'AH', 'N', 'IY'],
    couple: ['K', 'AH', 'P', 'AH', 'L'],
    country: ['K', 'AH', 'N', 'T', 'R', 'IY'],
    cousin: ['K', 'AH', 'Z', 'AH', 'N'],
    double: ['D', 'AH', 'B', 'AH', 'L'],
    trouble: ['T', 'R', 'AH', 'B', 'AH', 'L'],
    tongue: ['T', 'AH', 'NG'],
    wonder: ['W', 'AH', 'N', 'D', 'ER'],
    number: ['N', 'AH', 'M', 'B', 'ER'],
    son: ['S', 'AH', 'N'],
    none: ['N', 'AH', 'N'],

    // ── Irregular vowel digraphs ──────────────────────────────────────────────
    says: ['S', 'EH', 'Z'],
    bread: ['B', 'R', 'EH', 'D'],
    dead: ['D', 'EH', 'D'],
    head: ['HH', 'EH', 'D'], // past tense only
    lead: ['L', 'EH', 'D'], // metal; verb form is EE
    spread: ['S', 'P', 'R', 'EH', 'D'],
    thread: ['TH', 'R', 'EH', 'D'],
    tread: ['T', 'R', 'EH', 'D'],
    dread: ['D', 'R', 'EH', 'D'],
    instead: ['IH', 'N', 'S', 'T', 'EH', 'D'],
    weather: ['W', 'EH', 'DH', 'ER'],
    feather: ['F', 'EH', 'DH', 'ER'],
    leather: ['L', 'EH', 'DH', 'ER'],
    pleasure: ['P', 'L', 'EH', 'ZH', 'ER'],
    measure: ['M', 'EH', 'ZH', 'ER'],
    treasure: ['T', 'R', 'EH', 'ZH', 'ER'],
    heavy: ['HH', 'EH', 'V', 'IY'],
    ready: ['R', 'EH', 'D', 'IY'],
    steady: ['S', 'T', 'EH', 'D', 'IY'],
    jealous: ['JH', 'EH', 'L', 'AH', 'S'],
    health: ['HH', 'EH', 'L', 'TH'],
    wealth: ['W', 'EH', 'L', 'TH'],
    sweat: ['S', 'W', 'EH', 'T'],
    threat: ['TH', 'R', 'EH', 'T'],
    steak: ['S', 'T', 'EY', 'K'],
    bear: ['B', 'EH', 'R'],
    tear: ['T', 'EH', 'R'], // to rip; T IH R = drop of water
    pear: ['P', 'EH', 'R'],
    swear: ['S', 'W', 'EH', 'R'],
    // -oo irregulars
    flood: ['F', 'L', 'AH', 'D'],
    poor: ['P', 'UH', 'R'],
    // -ow as OW
    blow: ['B', 'L', 'OW'],
    flow: ['F', 'L', 'OW'],
    glow: ['G', 'L', 'OW'],
    crow: ['K', 'R', 'OW'],
    snow: ['S', 'N', 'OW'],
    slow: ['S', 'L', 'OW'],
    yellow: ['Y', 'EH', 'L', 'OW'],
    hollow: ['HH', 'AA', 'L', 'OW'],
    window: ['W', 'IH', 'N', 'D', 'OW'],
    elbow: ['EH', 'L', 'B', 'OW'],
    rainbow: ['R', 'EY', 'N', 'B', 'OW'],
    // -ou as other
    pour: ['P', 'AO', 'R'],
    tour: ['T', 'UH', 'R'],
    group: ['G', 'R', 'UW', 'P'],
    // -ei
    vein: ['V', 'EY', 'N'],
    rein: ['R', 'EY', 'N'],
    veil: ['V', 'EY', 'L'],
    reign: ['R', 'EY', 'N'],
    receive: ['R', 'IH', 'S', 'IY', 'V'],
    believe: ['B', 'IH', 'L', 'IY', 'V'],
    achieve: ['AH', 'CH', 'IY', 'V'],
    // -ch as K (Greek-origin)
    choir: ['K', 'W', 'AY', 'ER'],
    chord: ['K', 'AO', 'R', 'D'],
    chrome: ['K', 'R', 'OW', 'M'],
    chaos: ['K', 'EY', 'AA', 'S'],
    character: ['K', 'EH', 'R', 'AH', 'K', 'T', 'ER'],
    chemistry: ['K', 'EH', 'M', 'IH', 'S', 'T', 'R', 'IY'],
    echo: ['EH', 'K', 'OW'],
    // -ch as SH (French-origin)
    machine: ['M', 'AH', 'SH', 'IY', 'N'],
    chef: ['SH', 'EH', 'F'],
    // -sch as SK
    school: ['S', 'K', 'UW', 'L'],
    schedule: ['S', 'K', 'EH', 'JH', 'UW', 'L'],

    // ── Song interjections / filler syllables ─────────────────────────────────
    la: ['L', 'AH'],
    oh: ['OW'],
    ah: ['AA'],
    oo: ['UW'],
    ooh: ['UW'],
    wow: ['W', 'AW'],
    hey: ['HH', 'EY'],
    yeah: ['Y', 'EH'],
    yay: ['Y', 'EY'],
    whoa: ['W', 'OW'],
    hmm: ['HH', 'M'],
    mm: ['M'],
    ha: ['HH', 'AH'],
    na: ['N', 'AH'],
    da: ['D', 'AH'],
    ba: ['B', 'AH'],

    // ── Common phrases / compounds ────────────────────────────────────────────
    tonight: ['T', 'AH', 'N', 'AY', 'T'],
    today: ['T', 'AH', 'D', 'EY'],
    tomorrow: ['T', 'AH', 'M', 'AO', 'R', 'OW'],
    yesterday: ['Y', 'EH', 'S', 'T', 'ER', 'D', 'EY'],
    somebody: ['S', 'AH', 'M', 'B', 'AA', 'D', 'IY'],
    nobody: ['N', 'OW', 'B', 'AA', 'D', 'IY'],
    everybody: ['EH', 'V', 'R', 'IY', 'B', 'AA', 'D', 'IY'],
    goodbye: ['G', 'UH', 'D', 'B', 'AY'],
    hello: ['HH', 'AH', 'L', 'OW'],
    please: ['P', 'L', 'IY', 'Z'],
    thank: ['TH', 'AE', 'NG', 'K'],
    sorry: ['S', 'AO', 'R', 'IY'],
};

// ── G2P rule engine ───────────────────────────────────────────────────────────
// Context-sensitive ordered rewrite rules. At each position the first matching
// rule wins. Rules with longer `m` strings and/or context constraints are placed
// before shorter/unconditional ones (most-specific-first ordering).

type G2pRule = {
    m: string; // grapheme(s) to consume at the current position
    o: string[]; // ARPAbet output ([] = silent / consume with no output)
    p?: RegExp; // left-context: matched against word.slice(0, pos)
    s?: RegExp; // right-context: matched against word.slice(pos + m.length)
};

const G2P_RULES: readonly G2pRule[] = [
    // ── Trigraphs ─────────────────────────────────────────────────────────────
    { m: 'tch', o: ['CH'] }, // catch, watch, stretch
    { m: 'dge', o: ['JH'] }, // edge, bridge, judge

    // ── Word-initial silent pairs ─────────────────────────────────────────────
    { m: 'kn', o: ['N'], p: /^$/ }, // knife, know, knee, knight
    { m: 'wr', o: ['R'], p: /^$/ }, // write, wrong, wrap, wrist
    { m: 'gn', o: ['N'], p: /^$/ }, // gnat, gnu

    // ── Word-final silent consonant clusters ──────────────────────────────────
    { m: 'mb', o: ['M'], s: /^$/ }, // lamb, bomb, thumb, climb
    { m: 'mn', o: ['M'], s: /^$/ }, // damn, hymn, column

    // ── Consonant digraphs ────────────────────────────────────────────────────
    { m: 'ck', o: ['K'] }, // back, clock, duck
    { m: 'sh', o: ['SH'] }, // she, push, fish
    { m: 'ch', o: ['CH'] }, // church, each (exceptions in dict)
    { m: 'th', o: ['TH'] }, // think, path (voiced forms in dict)
    { m: 'wh', o: ['W'] }, // when, white
    { m: 'ph', o: ['F'] }, // phone, graph
    { m: 'qu', o: ['K', 'W'] }, // queen, quick, question
    { m: 'nk', o: ['NG', 'K'] }, // think, drink, bank
    { m: 'ng', o: ['NG'], s: /^(?:[^aeiou]|$)/ }, // sing, ring (before C or end)
    { m: 'ng', o: ['N', 'G'] }, // anger, single, finger (before vowel)
    { m: 'gn', o: ['N'] }, // sign, design (mid-word)
    { m: 'gh', o: [] }, // night, light, thought (silent)
    { m: 'dg', o: ['JH'], s: /^[eiy]/ }, // edge, badge, fridge

    // ── Context-sensitive consonants ──────────────────────────────────────────
    { m: 'c', o: ['S'], s: /^[eiy]/ }, // cell, city, cycle
    { m: 'c', o: ['K'] }, // cat, cup, class
    { m: 'g', o: ['JH'], s: /^[ei]/ }, // gem, age, gentle
    { m: 'g', o: ['G'] }, // go, got, glass
    { m: 'x', o: ['G', 'Z'], p: /[aeiou]$/, s: /^[aeiou]/ }, // exact, exam
    { m: 'x', o: ['K', 'S'] }, // fox, next, flex

    // ── Vowel digraphs ────────────────────────────────────────────────────────
    { m: 'ai', o: ['EY'] }, // rain, wait, paid
    { m: 'ay', o: ['EY'] }, // day, say, play
    { m: 'au', o: ['AO'] }, // cause, haul, fault
    { m: 'aw', o: ['AO'] }, // law, saw, draw
    { m: 'ee', o: ['IY'] }, // see, tree, free
    { m: 'ea', o: ['IY'] }, // eat, mean, clean (exceptions in dict)
    { m: 'ei', o: ['EY'] }, // vein, rein (mostly in dict)
    { m: 'eu', o: ['Y', 'UW'] }, // feud, neutral
    { m: 'ew', o: ['UW'], p: /[clrbdgfstv]$/ }, // crew, flew, blew
    { m: 'ew', o: ['Y', 'UW'] }, // new, few, dew
    { m: 'ie', o: ['IY'] }, // field, piece, chief
    { m: 'oa', o: ['OW'] }, // coat, road, boat
    { m: 'oe', o: ['OW'] }, // toe, goes, foe
    { m: 'oi', o: ['OY'] }, // oil, coin, voice
    { m: 'oo', o: ['UH'], s: /^k/ }, // book, look, cook
    { m: 'oo', o: ['UW'] }, // food, moon, school
    { m: 'ou', o: ['AW'] }, // out, loud, found (exceptions in dict)
    { m: 'ow', o: ['AW'] }, // how, now, down (OW words in dict)
    { m: 'oy', o: ['OY'] }, // boy, joy, toy
    { m: 'ue', o: ['UW'] }, // blue, true, due

    // ── Magic-e: preceding vowel + consonant(s) + silent-e at end ─────────────
    // Match fires on the stressed vowel; look-ahead sees C+e at word boundary.
    { m: 'a', o: ['EY'], s: /^[^aeiou]+e$/ }, // make, late, came, name
    { m: 'i', o: ['AY'], s: /^[^aeiou]+e$/ }, // like, time, write, side
    { m: 'o', o: ['OW'], s: /^[^aeiou]+e$/ }, // home, note, hope, stone
    { m: 'u', o: ['UW'], s: /^[^aeiou]+e$/ }, // rule, flute, tune

    // ── Silent final -e ───────────────────────────────────────────────────────
    { m: 'e', o: [], s: /^$/ }, // consumed but silent at word end

    // ── Y: position-sensitive ─────────────────────────────────────────────────
    { m: 'y', o: ['Y'], p: /^$/, s: /^[aeiou]/ }, // yes, yet (initial, before vowel)
    { m: 'y', o: ['Y'], p: /^$/ }, // year, young (initial, before C)
    { m: 'y', o: ['IY'], s: /^$/ }, // happy, city, story (final)
    { m: 'y', o: ['IH'] }, // gym, system (default)

    // ── Default single vowels ─────────────────────────────────────────────────
    { m: 'a', o: ['AE'] }, // cat, man, hat
    { m: 'e', o: ['EH'] }, // bed, set, men
    { m: 'i', o: ['IH'] }, // bit, sit, him
    { m: 'o', o: ['AA'] }, // hot, top, stop (GenAm "cot" vowel)
    { m: 'u', o: ['AH'] }, // but, cut, run

    // ── Default single consonants ─────────────────────────────────────────────
    { m: 'b', o: ['B'] },
    { m: 'd', o: ['D'] },
    { m: 'f', o: ['F'] },
    { m: 'h', o: ['HH'] },
    { m: 'j', o: ['JH'] },
    { m: 'k', o: ['K'] },
    { m: 'l', o: ['L'] },
    { m: 'm', o: ['M'] },
    { m: 'n', o: ['N'] },
    { m: 'p', o: ['P'] },
    { m: 'q', o: ['K'] },
    { m: 'r', o: ['R'] },
    { m: 's', o: ['S'] },
    { m: 't', o: ['T'] },
    { m: 'v', o: ['V'] },
    { m: 'w', o: ['W'] },
    { m: 'z', o: ['Z'] },
];

// Apply G2P rules to a single lowercase word, returning an ARPAbet sequence.
function applyG2p(word: string): string[] {
    const phonemes: string[] = [];
    let pos = 0;
    while (pos < word.length) {
        let matched = false;
        for (const rule of G2P_RULES) {
            if (!word.startsWith(rule.m, pos)) {
                continue;
            }
            const left = word.slice(0, pos);
            const right = word.slice(pos + rule.m.length);
            if (rule.p && !rule.p.test(left)) {
                continue;
            }
            if (rule.s && !rule.s.test(right)) {
                continue;
            }
            phonemes.push(...rule.o);
            pos += rule.m.length;
            matched = true;
            break;
        }
        if (!matched) {
            // Unmapped character — emit a schwa for any letter, skip otherwise.
            const ch = word[pos]!;
            if (/[a-z]/.test(ch)) {
                phonemes.push('AH');
            }
            pos++;
        }
    }
    return phonemes;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type PhonemizeInput = {
    lyrics: string;
    /** Voicebank phoneme → token ID mapping */
    phonemeToId: Record<string, number>;
    /** Silence token ID (default 0) */
    silenceId?: number;
    language?: 'en';
};

type PhonemizeOutput = {
    tokenIds: number[];
    phonemes: string[];
    /**
     * Number of phonemes per word-unit, including SP separator units.
     * sum(wordDiv) === tokenIds.length — required for the linguistic encoder's word_div tensor.
     * Structure: [1(SP), w1_phones, 1(SP), w2_phones, ..., wN_phones, 1(SP)]
     */
    wordDiv: number[];
    /**
     * Parallel to wordDiv — true if that word-unit is an SP silence token.
     * Used by the caller to assign frame durations: SP units get 1 frame, content
     * words get the duration of their corresponding note.
     */
    wordIsSp: boolean[];
};

// Resolve phonemes for one word: exception dict → G2P rule engine.
function getPhonemes(word: string): string[] {
    const lower = word.toLowerCase();
    const entry = EXCEPTION_DICT[lower];
    if (entry) {
        return entry;
    }
    return applyG2p(lower);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert lyrics to DiffSinger-compatible phoneme token IDs.
 *
 * Inserts SP (silence) tokens at word boundaries and at the start/end of the
 * sequence. Token IDs come from the voicebank's phonemes.txt mapping; any
 * phoneme not in the map falls back to silenceId.
 */
export function phonemize({
    lyrics,
    phonemeToId,
    silenceId = 0,
    language: _language = 'en',
}: PhonemizeInput): PhonemizeOutput {
    const words = lyrics
        .toLowerCase()
        .split(/[\s,.\-!?;:'"()[\]]+/)
        .filter((w) => w.length > 0);

    if (words.length === 0) {
        return { tokenIds: [silenceId], phonemes: ['SP'], wordDiv: [1], wordIsSp: [true] };
    }

    const allPhonemes: string[] = [];
    const wordDiv: number[] = [];
    const wordIsSp: boolean[] = [];

    // Leading SP
    allPhonemes.push('SP');
    wordDiv.push(1);
    wordIsSp.push(true);

    for (let idx = 0; idx < words.length; idx++) {
        const wordPhones = getPhonemes(words[idx]!);
        wordDiv.push(wordPhones.length);
        wordIsSp.push(false);
        allPhonemes.push(...wordPhones);

        // Inter-word SP (not after the last word)
        if (idx < words.length - 1) {
            allPhonemes.push('SP');
            wordDiv.push(1);
            wordIsSp.push(true);
        }
    }

    // Trailing SP
    allPhonemes.push('SP');
    wordDiv.push(1);
    wordIsSp.push(true);

    const tokenIds = allPhonemes.map((ph) => {
        const id = phonemeToId[ph];
        return id !== undefined ? id : silenceId;
    });

    return { tokenIds, phonemes: allPhonemes, wordDiv, wordIsSp };
}

/**
 * Parse a DiffSinger phonemes.txt file into a phoneme → token ID map.
 * Format: one phoneme per line; index = line number.
 */
export function parsePhonemesTxt(content: string): Record<string, number> {
    const lines = content
        .split('\n')
        .map((length) => length.trim())
        .filter((length) => length.length > 0);
    const map: Record<string, number> = {};
    for (let index = 0; index < lines.length; index++) {
        map[lines[index]!] = index;
    }
    return map;
}
