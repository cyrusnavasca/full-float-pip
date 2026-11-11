// Run: node --test tests/
// Evaluates FloatWindow.swift's in-page mediaTracksJS against a fake page and
// checks the playback-speed part of the ⚙ menu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const swift = readFileSync(new URL('../native-app/Sources/FloatWindow.swift', import.meta.url), 'utf8');
const source = swift.split('static let mediaTracksJS = """\n')[1].split('\n    """')[0];

function page({ youtube }) {
    const video = { playbackRate: 1 };
    const player = {
        rate: 1,
        classList: { contains: () => false },
        getAvailableAudioTracks: () => [],
        getAudioTrack: () => null,
        getOption: () => null,
        getPlaybackRate() { return this.rate; },
        setPlaybackRate(r) { this.rate = r; },
    };
    const document = {
        getElementById: (id) => (youtube && id === 'movie_player' ? player : null),
        querySelector: (sel) => (sel === 'video' ? video : null),
    };
    const run = (req) => vm.runInNewContext(`(${source})(req)`, { document, window: {}, req, setTimeout });
    return { run, video, player };
}

test('query reports the current speed on YouTube', () => {
    const p = page({ youtube: true });
    p.player.rate = 1.5;
    assert.equal(p.run({ action: 'query' }).rate, 1.5);
});

test('picking a speed sets it through the YouTube player', () => {
    const p = page({ youtube: true });
    assert.equal(p.run({ action: 'select', type: 'speed', id: '1.75' }), 'ok');
    assert.equal(p.player.rate, 1.75);
});

test('speed works on plain HTML5 video with no track options', () => {
    const p = page({ youtube: false });
    p.video.playbackRate = 0.75;
    assert.equal(p.run({ action: 'query' }).rate, 0.75);
    assert.equal(p.run({ action: 'select', type: 'speed', id: '2' }), 'ok');
    assert.equal(p.video.playbackRate, 2);
});
