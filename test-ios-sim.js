#!/usr/bin/env node
/* iOS Safari audio simulator test.
   We can't run real WebKit, but we reproduce the EXACT iOS failure modes:
   A) normal     — resume() works, state -> running
   B) iOS17 hang — resume() promise NEVER settles (but state becomes running)
   C) blocked    — resume() rejects, state stays 'suspended' forever
   and assert the app still runs the counter and picks a sane audio path.
   Uses fast mode (IN=.4s, OUT=.8s) so cycles complete quickly. */
'use strict';
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
let js = html.match(/<script>([\s\S]*?)<\/script>/g)
  .map(s => s.replace(/<\/?script>/g, ''))
  .join('\n');
// fast mode: 12s cycle -> 1.2s
js = js.replace('var IN=4,OUT=8,CYCLE=IN+OUT;', 'var IN=.4,OUT=.8,CYCLE=IN+OUT;');
// expose internals by injecting the hook INSIDE the IIFE (before its final close)
const marker = '})();';
const hook = 'window.__app={start:start,stop:stop,draw:draw,scheduler:scheduler,audioGo:audioGo,glideWavUrl:glideWavUrl,primeFallback:primeFallback,unmuteFallback:unmuteFallback,updateStatus:updateStatus};';
const mIdx = js.lastIndexOf(marker);
if (mIdx === -1) { console.error('IIFE close not found'); process.exit(1); }
js = js.slice(0, mIdx) + hook + marker + js.slice(mIdx + marker.length);

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  PASS  ' + name);
  else { failures++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}

function makeEl(id) {
  const el = {
    id, textContent: '', style: {}, className: '', innerHTML: '',
    _attrs: {}, children: [], _listeners: {},
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k]; },
    appendChild() {}, createTextNode() {},
    addEventListener(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); },
  };
  return el;
}

const audioEls = [];
class FakeAudio {
  constructor(src) { this.src = src; this.volume = 1; this.loop = false; this.currentTime = 0; this.paused = true; this._t = null; audioEls.push(this); }
  play() {
    this.paused = false;
    this._t = setInterval(() => { if (!this.paused) this.currentTime += 0.1; }, 100);
    return Promise.resolve();
  }
  pause() { this.paused = true; if (this._t) clearInterval(this._t); }
}

class OscNode {
  constructor(ctx) { this.ctx = ctx; this.type = 'sine'; this.frequency = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }; this.onended = null; this.startT = null; this.stopT = null; }
  connect() {} disconnect() {}
  start(t) { this.startT = t; this.ctx.oscs.push(this); }
  stop(t) { this.stopT = t; if (this.onended) setTimeout(() => this.onended(), 0); }
}
class GainNode { constructor() { this.gain = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }; } connect() {} disconnect() {} }
class Biquad { constructor() { this.type = ''; this.frequency = { value: 0 }; this.Q = { value: 0 }; } connect() {} disconnect() {} }

function runScenario(name, ctxImpl) {
  console.log('\n== ' + name + ' ==');
  audioEls.length = 0;
  const ids = ['trace', 'dot', 'phrase', 'phase', 'count', 'play', 'vol', 'buzz', 'preset', 'sound', 'track', 'audioStatus', 'installHint', 'dismissInstall', 'iosNote', 'ver'];
  const els = {};
  ids.forEach(id => els[id] = makeEl(id));
  els.vol.value = '55';
  els.sound.value = 'smooth';
  els.preset.value = 'closer-en';

  const doc = {
    getElementById(id) { return els[id] || (els[id] = makeEl(id)); },
    createElement() { return makeEl(''); },
    createTextNode(t) { return { textContent: t }; },
    addEventListener(evt, fn) { (this._L = this._L || {})[evt] = (this._L[evt] || []).concat(fn); },
    _L: {},
  };

  let rafCb = null;
  const raf = cb => { rafCb = cb; return 1; };
  const cancelRaf = () => { rafCb = null; };
  function pumpFrames(n) { for (let i = 0; i < n; i++) { const c = rafCb; if (c) c(performance.now()); } }

  const ctxObj = new ctxImpl();
  const AudioContext = function () { return ctxObj; };

  const navigator = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15', vibrate() {} };

  const fn = new Function('window', 'document', 'navigator', 'AudioContext', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'btoa', 'sessionStorage', 'matchMedia', 'Audio', 'URL',
    js);
  const win = { navigator, matchMedia: () => ({ matches: false }), AudioContext, webkitAudioContext: AudioContext, addEventListener() {} };
  fn(win, doc, navigator, AudioContext, raf, cancelRaf, performance, setInterval, clearInterval, setTimeout, clearTimeout, btoa, { getItem() { return null; }, setItem() {} }, () => ({ matches: false }), FakeAudio, {});
  const app = win.__app;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function tapStart() { (els.play._listeners.click || []).forEach(f => f()); }
  function touch() { (doc._L['touchstart'] || []).forEach(f => f()); }
  function status() { return els.audioStatus.textContent; }
  // mimic a real browser: pump an animation frame continuously (60fps)
  const pumpIv = setInterval(() => pumpFrames(1), 16);
  const cleanup = () => clearInterval(pumpIv);

  return { app, els, sleep, tapStart, touch, status, ctxObj, cleanup };
}

(async function main() {
  // ── Scenario A: normal iOS (audio works) ──
  {
    const ctxImpl = class {
      constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.oscs = []; }
      createGain() { return new GainNode(); }
      createOscillator() { return new OscNode(this); }
      createBiquadFilter() { return new Biquad(); }
      resume() { this.state = 'running'; return Promise.resolve(); }
      suspend() { this.state = 'suspended'; return Promise.resolve(); }
    };
    const s = runScenario('A: normal iOS (audio works)', ctxImpl);
    s.touch(); s.tapStart();
    await s.sleep(1100);
    check('button says Pause', s.els.play.textContent === 'Pause', s.els.play.textContent);
    check('status = audio: running', s.status() === 'audio: running', s.status());
    check('web oscillators scheduled', s.ctxObj.oscs.length > 0, 'oscs=' + s.ctxObj.oscs.length);
    check('fallback kept silent', audioEls.filter(a => a.volume > 0).length === 0);
    await s.sleep(1700); // 2.8s total > 2 cycles (2.4s)
    const n = parseInt(s.els.count.textContent) || 0;
    check('count increments over cycles (>=2)', n >= 2, s.els.count.textContent);
    s.tapStart(); // stop
    check('stop returns button to Start', s.els.play.textContent === 'Start');
    check('phase says paused', s.els.phase.textContent === 'paused', s.els.phase.textContent);
    s.cleanup();
  }

  // ── Scenario B: iOS 17 hang (resume() promise never settles) ──
  {
    const ctxImpl = class {
      constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.oscs = []; }
      createGain() { return new GainNode(); }
      createOscillator() { return new OscNode(this); }
      createBiquadFilter() { return new Biquad(); }
      resume() { this.state = 'running'; return new Promise(() => {}); } // never settles!
      suspend() { this.state = 'suspended'; return Promise.resolve(); }
    };
    const s = runScenario('B: iOS17 hang (resume() promise never settles)', ctxImpl);
    s.touch(); s.tapStart();
    await s.sleep(2700);
    const nB = parseInt(s.els.count.textContent) || 0;
    check('counter STILL advances (never waits on promise)', nB >= 2, s.els.count.textContent);
    check('status = audio: running (state polled)', s.status() === 'audio: running', s.status());
    check('web oscillators scheduled', s.ctxObj.oscs.length > 0, 'oscs=' + s.ctxObj.oscs.length);
    s.tapStart(); s.cleanup();
  }

  // ── Scenario C: audio fully blocked (context never runs) ──
  {
    const ctxImpl = class {
      constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.oscs = []; }
      createGain() { return new GainNode(); }
      createOscillator() { return new OscNode(this); }
      createBiquadFilter() { return new Biquad(); }
      resume() { return Promise.reject(new Error('not allowed to start')); }
      suspend() { return Promise.resolve(); }
    };
    const s = runScenario('C: audio fully blocked (context never runs)', ctxImpl);
    s.touch(); s.tapStart();
    await s.sleep(1100);
    check('status = audio: fallback tone', s.status() === 'audio: fallback tone', s.status());
    check('fallback audio playing and unmuted', audioEls.some(a => a.volume > 0 && !a.paused));
    await s.sleep(1700); // 2.8s total > 2 cycles (2.4s)
    const nC = parseInt(s.els.count.textContent) || 0;
    check('counter STILL advances (wall clock)', nC >= 2, s.els.count.textContent);
    // validate the fallback WAV (pick the LARGEST data-URI wav — the warmup is tiny)
    const fb = audioEls.filter(a => a.src && a.src.startsWith('data:audio/wav')).sort((x, y) => y.src.length - x.src.length)[0];
    check('fallback WAV generated', !!fb && fb.src.length > 10000, 'audioEls=' + audioEls.length + ' len=' + (fb ? fb.src.length : 0));
    if (fb) {
      const b64 = fb.src.split(',')[1];
      const buf = Buffer.from(b64, 'base64');
      check('WAV RIFF header', buf.toString('latin1', 0, 4) === 'RIFF');
      check('WAV WAVE tag', buf.toString('latin1', 8, 12) === 'WAVE');
      const sr = buf.readUInt32LE(24);
      const dataSize = buf.readUInt32LE(40);
      const dur = dataSize / 2 / sr;
      check('WAV sample rate 22050', sr === 22050, 'sr=' + sr);
      check('WAV duration ~ cycle (1.2s in fast mode)', Math.abs(dur - 1.2) < 0.01, 'dur=' + dur.toFixed(3));
      check('WAV not truncated (bytes == 44+dataSize)', buf.length === 44 + dataSize, 'bytes=' + buf.length + ' expected=' + (44 + dataSize));
      let max = 0;
      for (let i = 44; i < Math.min(buf.length, 44 + 4000); i += 2) {
        const v = Math.abs(buf.readInt16LE(i)) / 32767;
        if (v > max) max = v;
      }
      check('WAV has audible content (max>0.2)', max > 0.2, 'max=' + max.toFixed(3));
    }
    s.tapStart(); // stop
    check('stop pauses fallback audio', fb ? fb.paused : false);
    s.cleanup();
  }

  // ── Scenario D: start/stop/start race ──
  {
    const ctxImpl = class {
      constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.oscs = []; }
      createGain() { return new GainNode(); }
      createOscillator() { return new OscNode(this); }
      createBiquadFilter() { return new Biquad(); }
      resume() { this.state = 'running'; return Promise.resolve(); }
      suspend() { this.state = 'suspended'; return Promise.resolve(); }
    };
    const s = runScenario('D: start/stop/start race', ctxImpl);
    s.touch(); s.tapStart();
    await s.sleep(120); s.tapStart(); // stop quickly
    await s.sleep(120); s.tapStart(); // start again
    await s.sleep(1500);
    check('restart keeps running', s.els.play.textContent === 'Pause', s.els.play.textContent);
    const nD = parseInt(s.els.count.textContent) || 0;
    check('counter advances after restart', nD >= 1, s.els.count.textContent);
    s.tapStart();
    check('final stop clean', s.els.play.textContent === 'Start');
    s.cleanup();
  }

  console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED ✅' : failures + ' TEST(S) FAILED ❌'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
