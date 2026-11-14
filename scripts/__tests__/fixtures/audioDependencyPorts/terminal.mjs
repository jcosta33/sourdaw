import assert from 'node:assert/strict';
export function terminalContract({ stringWidth, wrapAnsi, cliui, yargs, ansiStyles }) {
    for (const [text, width] of [
        ['abc', 3],
        ['古', 2],
        ['e\u0301', 1],
        ['👩‍👩‍👧‍👦', 2],
        ['\u001B[31m古\u001B[39m', 2],
    ])
        assert.equal(stringWidth(text), width);
    assert.equal(stringWidth('\u001B[31m古\u001B[39m', { countAnsiEscapeCodes: true }) > 2, true);
    assert.equal(wrapAnsi('abcd', 2, { hard: true }), 'ab\ncd');
    assert.equal(wrapAnsi('古古', 2, { hard: true }), '古\n古');
    assert.equal(
        wrapAnsi('\u001B[31mabcd\u001B[39m', 2, { hard: true }),
        '\u001B[31mab\u001B[39m\n\u001B[31mcd\u001B[39m'
    );
    assert.equal(ansiStyles.codes.get(31), 39);
    const ui = cliui({ width: 8 });
    ui.div('古古');
    assert.equal(ui.toString(), '古古');
    const argv = yargs(['--config', '音-🎹.json'])
        .exitProcess(false)
        .option('config', { type: 'string', demandOption: true })
        .parseSync();
    assert.equal(argv.config, '音-🎹.json');
}
