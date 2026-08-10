import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(projectRoot, "browser-extension");
const fixturePath = process.env.GREEK_VEIL_REPLAY_HTML || path.join(projectRoot, "tests", "fixture.html");
const customReplay = Boolean(process.env.GREEK_VEIL_REPLAY_HTML);
const defaultChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromePath = process.env.GREEK_VEIL_CHROME_PATH || defaultChromePath;
const { stdout: versionOutput } = await promisify(execFile)(chromePath, ["--version"]);
const majorVersion = Number(versionOutput.match(/\b(\d+)\./)?.[1] || 0);
const directReplay = !process.env.GREEK_VEIL_CHROME_PATH &&
  chromePath === defaultChromePath &&
  majorVersion >= 137;

const profilePath = await mkdtemp(path.join(os.tmpdir(), "greek-veil-chrome-"));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll(fn, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await wait(100);
  }
  throw lastError || new Error("Timed out waiting for Chrome");
}

class Cdp {
  constructor(url) {
    this.sequence = 0;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close() {
    this.socket.close();
  }
}

const rawFixture = await readFile(fixturePath, "utf8");
const fixture = directReplay
  ? rawFixture.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  : rawFixture;
const server = http.createServer((request, response) => {
  if (request.url === "/fixture.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixture);
  } else {
    response.writeHead(404);
    response.end("Not found");
  }
});

const fixturePort = await freePort();
const debugPort = await freePort();
await new Promise((resolve) => server.listen(fixturePort, "127.0.0.1", resolve));

const chromeArguments = [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profilePath}`,
  `http://127.0.0.1:${fixturePort}/fixture.html`
];
if (!directReplay) {
  chromeArguments.splice(-1, 0,
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`
  );
}
const chrome = spawn(chromePath, chromeArguments, { stdio: ["ignore", "ignore", "pipe"] });

let chromeErrors = "";
chrome.stderr.on("data", (chunk) => { chromeErrors += chunk.toString(); });

try {
  const target = await poll(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await response.json();
    return targets.find((item) => item.type === "page" && item.url.includes("/fixture.html"));
  }, 15_000);

  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  if (!directReplay) await cdp.send("Page.reload", { ignoreCache: true });
  await wait(300);

  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  };

  const eligibleCharacters = await evaluate(`(() => {
    const skip = 'script,style,noscript,code,pre,kbd,samp,textarea,input,select,option,svg,math,canvas';
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_TEXT);
    let total = 0, node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && !node.parentElement.closest(skip) && /[A-Za-z]/.test(node.nodeValue || '')) {
        total += ((node.nodeValue || '').match(/[A-Za-z]/g) || []).length;
      }
    }
    return total;
  })()`);

  if (directReplay) {
    const [coreSource, stateSource, greggSource, contentSource, contentCss] = await Promise.all([
      readFile(path.join(extensionPath, "shared/core.js"), "utf8"),
      readFile(path.join(extensionPath, "shared/state.js"), "utf8"),
      readFile(path.join(extensionPath, "shared/gregg.js"), "utf8"),
      readFile(path.join(extensionPath, "content.js"), "utf8"),
      readFile(path.join(extensionPath, "content.css"), "utf8")
    ]);
    await evaluate(coreSource);
    await evaluate(stateSource);
    await evaluate(greggSource);
    await evaluate(`(() => {
      const settings = GreekVeilState.DEFAULT_SETTINGS;
      const effective = GreekVeilState.resolveEffectiveState(settings, {}, location.href);
      const pack = GreekVeilCore.getPack(effective.packId);
      // This replay specifically exercises the DOM-preserving overlay path.
      // Default selection is covered by the state tests.
      effective.profileId = 'familiar';
      effective.renderer = 'overlay';
      effective.renderer = GreekVeilCore.resolveRenderer(pack, effective.renderer);
      const payload = { effective, pack, settings, catalog: [] };
      Object.assign(globalThis.chrome, {
        runtime: {
          sendMessage: async () => ({ ok: true, value: payload }),
          onMessage: { addListener(listener) { globalThis.__gvMessageListener = listener; } }
        },
        storage: {
          local: { get: async () => ({}) },
          onChanged: { addListener() {} }
        }
      });
      globalThis.__gvPayload = payload;
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(contentCss)};
      document.head.append(style);
    })()`);
    await evaluate(contentSource);
    if (!customReplay) {
      await evaluate(`setTimeout(() => {
        document.getElementById('dynamic').textContent = 'Updated private message';
      }, 150)`);
    }
  }

  try {
    await poll(async () => (await evaluate("document.querySelectorAll('[data-gv-overlay-part]').length")) > 0);
  } catch (error) {
    const targetsResponse = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await targetsResponse.json();
    const workerManifests = [];
    for (const worker of targets.filter((item) => item.type === "service_worker")) {
      const workerCdp = new Cdp(worker.webSocketDebuggerUrl);
      await workerCdp.open();
      await workerCdp.send("Runtime.enable");
      const manifestResult = await workerCdp.send("Runtime.evaluate", {
        expression: "chrome.runtime?.getManifest?.()",
        returnByValue: true
      });
      workerManifests.push(manifestResult.result.value || null);
      workerCdp.close();
    }
    const pageState = await evaluate(`({
      readyState: document.readyState,
      title: document.title,
      indicator: Boolean(document.getElementById('gv-indicator-host')),
      overlays: document.querySelectorAll('[data-gv-overlay-part]').length,
      html: document.documentElement.outerHTML.slice(0, 1000)
    })`);
    throw new Error(`${error.message}\nTargets: ${JSON.stringify(targets.map(({type,title,url}) => ({type,title,url})))}\nWorkers: ${JSON.stringify(workerManifests)}\nPage: ${JSON.stringify(pageState)}`);
  }
  await wait(250);

  const coveredCharacters = await evaluate(
    "[...document.querySelectorAll('[data-gv-overlay-part]')].reduce(" +
      "(sum, part) => sum + ((part.textContent || '').match(/[A-Za-z]/g) || []).length, 0)"
  );
  const coverage = eligibleCharacters ? coveredCharacters / eligibleCharacters : 0;
  const uncovered = await evaluate(`(() => {
    const skip = 'script,style,noscript,code,pre,kbd,samp,textarea,input,select,option,svg,math,canvas';
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_TEXT);
    const rows = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && !node.parentElement.closest(skip) &&
          !node.parentElement.closest('[data-gv-overlay-part],[data-gv-ui]') &&
          /[A-Za-z]/.test(node.nodeValue || '')) {
        rows.push({ tag: node.parentElement.tagName, text: (node.nodeValue || '').trim().slice(0, 80) });
      }
    }
    return rows.slice(0, 20);
  })()`);
  assert.ok(
    coverage > 0.8,
    `Expected >80% eligible-text coverage, received ${(coverage * 100).toFixed(1)}%. ` +
    `Uncovered: ${JSON.stringify(uncovered)}`
  );

  if (!customReplay) {
    assert.equal(await evaluate("document.getElementById('heading').textContent"), "Meet me at the library");
    assert.equal(await evaluate("document.getElementById('safe-input').value"), "Never transform this value");
    assert.match(await evaluate("document.getElementById('safe-code').textContent"), /never transform code/);
    assert.equal(await evaluate("document.getElementById('dynamic').textContent"), "Updated private message");
  }
  assert.ok(await evaluate("document.querySelectorAll('[data-gv-overlay-part]').length") > 4);
  assert.match(
    await evaluate("document.querySelector('[data-gv-overlay-part]').dataset.gvRendered"),
    /[Α-ω]/
  );
  assert.match(
    await evaluate("document.getElementById('gv-indicator-host').shadowRoot.getElementById('pill').textContent"),
    /Greek/
  );

  let longPageDurationMs = null;
  let spaSoakP95Ms = null;
  if (directReplay && !customReplay) {
    const wordVisibility = await evaluate(`(() => {
      const next = structuredClone(globalThis.__gvPayload);
      next.effective.clearWordFraction = 0.5;
      globalThis.__gvMessageListener({ type: 'gv-apply-state', payload: next }, {}, () => {});
      const parts = [...document.querySelectorAll('[data-gv-overlay-part]')];
      return {
        clearWords: parts.filter((part) =>
          /[A-Za-z]{2,}/.test(part.textContent) && part.dataset.gvRendered === part.textContent
        ).length,
        veiledWords: parts.filter((part) =>
          /[A-Za-z]{2,}/.test(part.textContent) && part.dataset.gvRendered !== part.textContent
        ).length,
        sensitiveRendered: parts.find((part) => part.textContent === 'alice@example.com')?.dataset.gvRendered
      };
    })()`);
    assert.ok(wordVisibility.clearWords > 0);
    assert.ok(wordVisibility.veiledWords > 0);
    assert.notEqual(wordVisibility.sensitiveRendered, "alice@example.com");

    const incompatibleSensitivePack = await evaluate(`(() => {
      const next = structuredClone(globalThis.__gvPayload);
      next.pack = GreekVeilCore.getPack('greek');
      next.effective.packId = 'greek';
      next.effective.profileId = 'dense';
      next.effective.renderer = 'unicode';
      next.effective.sensitiveMode = 'pack';
      next.effective.sensitivePackId = 'arabic';
      globalThis.__gvMessageListener({ type: 'gv-apply-state', payload: next }, {}, () => {});
      let diagnostics = null;
      globalThis.__gvMessageListener(
        { type: 'gv-get-diagnostics' },
        {},
        (response) => { diagnostics = response; }
      );
      return diagnostics.degraded;
    })()`);
    assert.match(incompatibleSensitivePack.join(" "), /Arabic glyphs cannot render/);
    assert.match(incompatibleSensitivePack.join(" "), /Dense profile is used instead/);

    const shadowRendering = await evaluate(`(async () => {
      const next = structuredClone(globalThis.__gvPayload);
      next.pack = GreekVeilCore.getPack('greek');
      next.effective.packId = 'greek';
      next.effective.profileId = 'familiar';
      next.effective.renderer = 'overlay';
      next.effective.clearWordFraction = 0;
      next.effective.veilTextInputs = true;
      globalThis.__gvMessageListener({ type: 'gv-apply-state', payload: next }, {}, () => {});

      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML =
        '<article><p id="shadow-message">Private shadow conversation</p>' +
        '<div contenteditable="true">shadow draft typing</div></article>';
      document.body.append(host);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const message = shadow.getElementById('shadow-message');
      const part = message.querySelector('[data-gv-overlay-part]');
      let diagnostics = null;
      globalThis.__gvMessageListener(
        { type: 'gv-get-diagnostics' },
        {},
        (response) => { diagnostics = response; }
      );
      const result = {
        source: message.textContent,
        rendered: part?.dataset.gvRendered || '',
        hasScopedStyle: Boolean(shadow.querySelector('style[data-gv-ui]')),
        editableSource: shadow.querySelector('[contenteditable]').textContent,
        shadowRoots: diagnostics?.shadowRoots,
        walks: diagnostics?.walks,
        html: shadow.innerHTML
      };
      host.remove();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return result;
    })()`);
    assert.equal(shadowRendering.source, "Private shadow conversation");
    assert.match(
      shadowRendering.rendered,
      /[Α-ω]/,
      `Open Shadow DOM was not rendered: ${JSON.stringify(shadowRendering)}`
    );
    assert.equal(shadowRendering.hasScopedStyle, true);
    assert.equal(shadowRendering.editableSource, "shadow draft typing");

    const longPageRendering = await evaluate(`(async () => {
      const disabled = structuredClone(globalThis.__gvPayload);
      disabled.pack = GreekVeilCore.getPack('greek');
      disabled.effective.packId = 'greek';
      disabled.effective.profileId = 'dense';
      disabled.effective.renderer = 'overlay';
      disabled.effective.clearWordFraction = 0;
      disabled.effective.veilTextInputs = false;
      disabled.effective.enabled = false;
      globalThis.__gvMessageListener({ type: 'gv-apply-state', payload: disabled }, {}, () => {});

      const chat = document.createElement('section');
      chat.id = 'long-chat-fixture';
      document.body.append(chat);
      for (let message = 0; message < 2000; message += 1) {
        const article = document.createElement('article');
        chat.append(article);
        let parent = article;
        for (let depth = 0; depth < 8; depth += 1) {
          const layer = document.createElement('div');
          parent.append(layer);
          parent = layer;
        }
        const paragraph = document.createElement('p');
        paragraph.textContent =
          'Private conversation message with detailed reasoning and a helpful response.';
        parent.append(paragraph);
        if (message % 40 === 0) {
          const code = document.createElement('code');
          code.textContent = 'const privateMessage = "must remain source text";';
          parent.append(code);
          const editable = document.createElement('div');
          editable.contentEditable = 'true';
          editable.textContent = 'Editable draft must remain source text';
          parent.append(editable);
        }
      }

      const enabled = structuredClone(disabled);
      enabled.effective.enabled = true;
      const startedAt = performance.now();
      globalThis.__gvMessageListener({ type: 'gv-apply-state', payload: enabled }, {}, () => {});
      // Include MutationObserver work queued by the live, nested construction
      // pattern used by client-rendered chat applications.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const durationMs = performance.now() - startedAt;
      const paragraphs = chat.querySelectorAll('p');
      const result = {
        durationMs,
        paragraphs: paragraphs.length,
        first: paragraphs[0]?.textContent || '',
        last: paragraphs[paragraphs.length - 1]?.textContent || '',
        firstRendered: chat.querySelector('[data-gv-overlay-part]')?.dataset.gvRendered || '',
        overlayParts: chat.querySelectorAll('[data-gv-overlay-part]').length,
        code: chat.querySelector('code')?.textContent || '',
        editable: chat.querySelector('[contenteditable]')?.textContent || ''
      };
      chat.remove();
      return result;
    })()`);
    assert.equal(longPageRendering.paragraphs, 2000);
    assert.match(longPageRendering.first, /Private conversation/);
    assert.match(longPageRendering.last, /Private conversation/);
    assert.match(longPageRendering.firstRendered, /[Α-ω]/);
    assert.ok(longPageRendering.overlayParts > 10000);
    assert.match(longPageRendering.code, /must remain source text/);
    assert.match(longPageRendering.editable, /must remain source text/);
    assert.ok(
      longPageRendering.durationMs < 2000,
      `Long-page Greek rendering exceeded 2000 ms: ${longPageRendering.durationMs.toFixed(1)} ms`
    );
    longPageDurationMs = longPageRendering.durationMs;

    const arabicRendering = await evaluate(`(async () => {
      const next = structuredClone(globalThis.__gvPayload);
      next.pack = GreekVeilCore.getPack('arabic');
      next.effective.packId = 'arabic';
      next.effective.profileId = 'familiar';
      next.effective.renderer = GreekVeilCore.resolveRenderer(next.pack, 'unicode');
      next.effective.clearWordFraction = 0;
      next.effective.veilTextInputs = true;
      globalThis.__gvMessageListener({ type: 'gv-apply-state', payload: next }, {}, () => {});
      const heading = document.getElementById('heading');
      const overlayParts = [...heading.querySelectorAll('[data-gv-overlay-part]')];
      const rendered = overlayParts
        .map((part) => part.dataset.gvRendered || '')
        .join('');
      const chatEditor = document.createElement('div');
      chatEditor.contentEditable = 'true';
      chatEditor.textContent = 'meet me typing';
      chatEditor.style.cssText =
        'width:320px;min-height:40px;padding:8px;font:16px/24px sans-serif;white-space:pre-wrap';
      document.body.append(chatEditor);
      chatEditor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(chatEditor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      chatEditor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
      await new Promise((resolve) => queueMicrotask(resolve));
      const chatMirror = document.querySelector('[data-gv-input-mirror="contenteditable"]');
      return {
        renderer: next.effective.renderer,
        source: heading.textContent,
        rendered,
        overlayParts: overlayParts.length,
        bidi: getComputedStyle(overlayParts[0], '::after').unicodeBidi,
        chatSource: chatEditor.textContent,
        chatMirror: chatMirror?.textContent || ''
      };
    })()`);
    assert.equal(arabicRendering.renderer, "overlay");
    assert.equal(arabicRendering.source, "Meet me at the library");
    assert.ok(arabicRendering.overlayParts > 0);
    assert.match(arabicRendering.rendered, /[\u0600-\u06ff]/u);
    assert.equal(arabicRendering.bidi, "isolate-override");
    assert.equal(arabicRendering.chatSource, "meet me typing");
    assert.equal(arabicRendering.chatMirror, "مععت مع typing");

    const kanaRendering = await evaluate(`(async () => {
      const next = structuredClone(globalThis.__gvPayload);
      next.pack = GreekVeilCore.getPack('katakana');
      next.effective.packId = 'katakana';
      next.effective.profileId = 'familiar';
      next.effective.renderer = 'unicode';
      next.effective.clearWordFraction = 0;
      next.effective.veilTextInputs = true;
      globalThis.__gvMessageListener({ type: 'gv-apply-state', payload: next }, {}, () => {});
      const input = document.getElementById('safe-input');
      input.focus();
      input.value = 'meet me ';
      input.setSelectionRange(input.value.length, input.value.length);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
      await new Promise((resolve) => queueMicrotask(resolve));
      const githubLikeInput = document.createElement('input');
      githubLikeInput.type = 'text';
      githubLikeInput.placeholder = 'Go to file';
      document.body.append(githubLikeInput);
      githubLikeInput.focus();
      githubLikeInput.value = 'private file ';
      githubLikeInput.setSelectionRange(githubLikeInput.value.length, githubLikeInput.value.length);
      // Deliberately omit an input event. Some controlled search widgets prevent
      // delegated listeners from observing their value update.
      await new Promise((resolve) => setTimeout(resolve, 180));
      const password = document.createElement('input');
      password.type = 'password';
      password.value = 'secret word ';
      document.body.append(password);
      await new Promise((resolve) => queueMicrotask(resolve));
      githubLikeInput.blur();
      await new Promise((resolve) => queueMicrotask(resolve));
      const chatEditor = document.createElement('div');
      chatEditor.id = 'prompt-textarea';
      chatEditor.contentEditable = 'true';
      chatEditor.textContent = 'meet me typing';
      chatEditor.style.cssText =
        'width:320px;min-height:40px;padding:8px;font:16px/24px sans-serif;white-space:pre-wrap';
      document.body.append(chatEditor);
      chatEditor.focus();
      const editorSelection = window.getSelection();
      const editorRange = document.createRange();
      editorRange.selectNodeContents(chatEditor);
      editorRange.collapse(false);
      editorSelection.removeAllRanges();
      editorSelection.addRange(editorRange);
      chatEditor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
      await new Promise((resolve) => queueMicrotask(resolve));

      const proseMirror = document.createElement('div');
      proseMirror.className = 'ProseMirror';
      proseMirror.contentEditable = 'true';
      proseMirror.innerHTML = '<p><span>private draft </span><strong>composing</strong></p>';
      document.body.append(proseMirror);
      proseMirror.focus();
      const proseSelection = window.getSelection();
      const proseRange = document.createRange();
      proseRange.selectNodeContents(proseMirror.querySelector('strong'));
      proseRange.collapse(false);
      proseSelection.removeAllRanges();
      proseSelection.addRange(proseRange);
      proseMirror.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
      await new Promise((resolve) => queueMicrotask(resolve));

      const lexical = document.createElement('div');
      lexical.dataset.lexicalEditor = 'true';
      lexical.contentEditable = 'true';
      lexical.innerHTML = '<p><span>meet me </span><span>composing</span></p>';
      document.body.append(lexical);
      lexical.focus();
      const lexicalSelection = window.getSelection();
      const lexicalRange = document.createRange();
      lexicalRange.selectNodeContents(lexical.querySelector('span:last-child'));
      lexicalRange.collapse(false);
      lexicalSelection.removeAllRanges();
      lexicalSelection.addRange(lexicalRange);
      lexical.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
      await new Promise((resolve) => queueMicrotask(resolve));
      const mirrorsBeforeComposition =
        document.querySelectorAll('[data-gv-input-mirror="contenteditable"]').length;
      lexical.dispatchEvent(new CompositionEvent('compositionstart', {
        bubbles: true,
        composed: true,
        data: ''
      }));
      const mirrorsDuringComposition =
        document.querySelectorAll('[data-gv-input-mirror="contenteditable"]').length;
      lexical.dispatchEvent(new CompositionEvent('compositionend', {
        bubbles: true,
        composed: true,
        data: 'x'
      }));
      await new Promise((resolve) => queueMicrotask(resolve));

      const mirrorTexts = [...document.querySelectorAll('[data-gv-input-mirror]')]
        .map((mirror) => mirror.textContent);
      return {
        heading: document.getElementById('heading').textContent,
        input: input.value,
        inputHidden: input.classList.contains('gv-input-source-hidden'),
        mirror: mirrorTexts.find((text) => text === 'ミート ミー '),
        githubMirror: mirrorTexts.find((text) => text === 'プライベート ファイル '),
        githubValue: githubLikeInput.value,
        passwordHidden: password.classList.contains('gv-input-source-hidden'),
        chatSource: chatEditor.textContent,
        chatMarkup: chatEditor.innerHTML,
        chatHidden: chatEditor.classList.contains('gv-input-source-hidden'),
        chatMirror: mirrorTexts.find((text) => text === 'ミート ミー typing'),
        proseSource: proseMirror.textContent,
        proseMarkup: proseMirror.innerHTML,
        proseMirror: mirrorTexts.find(
          (text) => text.endsWith('composing') && text.startsWith('プライベート')
        ),
        lexicalSource: lexical.textContent,
        lexicalMarkup: lexical.innerHTML,
        lexicalMirror: mirrorTexts.find((text) => text === 'ミート ミー composing'),
        compositionRemoved: mirrorsDuringComposition === mirrorsBeforeComposition - 1,
        compositionRestored:
          document.querySelectorAll('[data-gv-input-mirror="contenteditable"]').length ===
          mirrorsBeforeComposition,
        code: document.getElementById('safe-code').textContent
      };
    })()`);
    assert.equal(kanaRendering.heading, "ミート ミー アット ザ ライブラリー");
    assert.equal(kanaRendering.input, "meet me ");
    assert.equal(kanaRendering.inputHidden, true);
    assert.equal(kanaRendering.mirror, "ミート ミー ");
    assert.equal(kanaRendering.githubMirror, "プライベート ファイル ");
    assert.equal(kanaRendering.githubValue, "private file ");
    assert.equal(kanaRendering.passwordHidden, false);
    assert.equal(kanaRendering.chatSource, "meet me typing");
    assert.equal(kanaRendering.chatMarkup, "meet me typing");
    assert.equal(kanaRendering.chatHidden, true);
    assert.equal(kanaRendering.chatMirror, "ミート ミー typing");
    assert.equal(kanaRendering.proseSource, "private draft composing");
    assert.equal(
      kanaRendering.proseMarkup,
      "<p><span>private draft </span><strong>composing</strong></p>"
    );
    assert.match(
      kanaRendering.proseMirror,
      /^[\u30a0-\u30ffー]+ [\u30a0-\u30ffー]+ composing$/u
    );
    assert.equal(kanaRendering.lexicalSource, "meet me composing");
    assert.equal(
      kanaRendering.lexicalMarkup,
      "<p><span>meet me </span><span>composing</span></p>"
    );
    assert.equal(kanaRendering.lexicalMirror, "ミート ミー composing");
    assert.equal(kanaRendering.compositionRemoved, true);
    assert.equal(kanaRendering.compositionRestored, true);
    assert.match(kanaRendering.code, /never transform code/);

    const greggRendering = await evaluate(`(() => {
      const next = structuredClone(globalThis.__gvPayload);
      next.pack = GreekVeilCore.getPack('gregg-simplified');
      next.effective.packId = 'gregg-simplified';
      next.effective.profileId = 'simplified';
      next.effective.renderer = 'strokes';
      next.effective.clearWordFraction = 0.2;
      globalThis.__gvMessageListener({ type: 'gv-apply-state', payload: next }, {}, () => {});
      const strokeParts = [...document.querySelectorAll('[data-gv-stroke-part].gv-stroke')];
      const clearParts = [...document.querySelectorAll('[data-gv-stroke-part][data-gv-clear-word="true"]')];
      return {
        strokes: strokeParts.length,
        paths: document.querySelectorAll('[data-gv-stroke-svg] path').length,
        clearWords: clearParts.filter((part) => /[A-Za-z]{2,}/.test(part.textContent)).length,
        source: document.getElementById('heading').textContent
      };
    })()`);
    assert.ok(greggRendering.strokes > 4);
    assert.ok(greggRendering.paths > greggRendering.strokes);
    assert.ok(greggRendering.clearWords > 0);
    assert.equal(greggRendering.source, "Meet me at the library");

    const spaSoak = await evaluate(`(async () => {
      const overlay = structuredClone(globalThis.__gvPayload);
      overlay.pack = GreekVeilCore.getPack('greek');
      overlay.effective.packId = 'greek';
      overlay.effective.profileId = 'dense';
      overlay.effective.renderer = 'overlay';
      overlay.effective.clearWordFraction = 0;
      overlay.effective.veilTextInputs = false;
      globalThis.__gvMessageListener({ type: 'gv-apply-state', payload: overlay }, {}, () => {});
      await new Promise((resolve) => setTimeout(resolve, 0));

      const getDiagnostics = () => {
        let value = null;
        globalThis.__gvMessageListener(
          { type: 'gv-get-diagnostics' },
          {},
          (response) => { value = response; }
        );
        return value;
      };
      const baselineGroups = getDiagnostics().overlayGroups;
      const cycleDurations = [];
      for (let route = 0; route < 20; route += 1) {
        const startedAt = performance.now();
        const page = document.createElement('main');
        page.dataset.routeFixture = String(route);
        for (let message = 0; message < 40; message += 1) {
          const article = document.createElement('article');
          const paragraph = document.createElement('p');
          paragraph.textContent =
            'Virtualized private message with a stable route transition and response.';
          article.append(paragraph);
          page.append(article);
        }
        document.body.append(page);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const renderedBeforeUpdate =
          page.querySelectorAll('[data-gv-overlay-part]').length;
        page.querySelector('p').textContent =
          'Updated route message after a client-side navigation event.';
        await new Promise((resolve) => setTimeout(resolve, 0));
        const updated = page.querySelector('p').textContent;
        page.remove();
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!renderedBeforeUpdate || !/Updated route message/.test(updated)) {
          throw new Error('SPA route fixture did not render or update correctly');
        }
        cycleDurations.push(performance.now() - startedAt);
      }

      for (let transition = 0; transition < 8; transition += 1) {
        const next = structuredClone(overlay);
        next.effective.renderer = transition % 2 === 0 ? 'unicode' : 'overlay';
        globalThis.__gvMessageListener({ type: 'gv-apply-state', payload: next }, {}, () => {});
        await new Promise((resolve) => queueMicrotask(resolve));
      }
      globalThis.__gvMessageListener({ type: 'gv-apply-state', payload: overlay }, {}, () => {});
      await new Promise((resolve) => setTimeout(resolve, 0));

      const sorted = cycleDurations.slice().sort((a, b) => a - b);
      const diagnostics = getDiagnostics();
      return {
        baselineGroups,
        finalGroups: diagnostics.overlayGroups,
        p95Ms: sorted[Math.floor((sorted.length - 1) * 0.95)],
        maxMs: Math.max(...cycleDurations),
        heading: document.getElementById('heading').textContent,
        shadowAuditPasses: diagnostics.shadowAuditPasses,
        shadowAuditElements: diagnostics.shadowAuditElements,
        shadowAuditMaxSliceMs: diagnostics.shadowAuditMaxSliceMs
      };
    })()`);
    assert.equal(spaSoak.finalGroups, spaSoak.baselineGroups);
    assert.equal(spaSoak.heading, "Meet me at the library");
    assert.ok(
      spaSoak.p95Ms < 1000,
      `SPA soak p95 exceeded 1000 ms: ${spaSoak.p95Ms.toFixed(1)} ms`
    );
    assert.equal(spaSoak.shadowAuditPasses, 0);
    assert.equal(spaSoak.shadowAuditElements, 0);
    assert.equal(spaSoak.shadowAuditMaxSliceMs, 0);
    spaSoakP95Ms = spaSoak.p95Ms;

    await evaluate(`(() => {
      document.activeElement?.blur?.();
      const next = structuredClone(globalThis.__gvPayload);
      next.effective.veilTextInputs = false;
      globalThis.__gvMessageListener({ type: 'gv-apply-state', payload: next }, {}, () => {});
    })()`);
    assert.equal(await evaluate("document.querySelectorAll('[data-gv-input-mirror]').length"), 0);
    assert.equal(await evaluate("document.getElementById('safe-input').value"), "meet me ");
  }

  const revealedParts = await evaluate(`(() => {
    const first = document.querySelector('[data-gv-overlay-part]');
    const block = first.closest('p,li,blockquote,article,section,td,th,dd,dt,h1,h2,h3,h4,h5,h6,figcaption,button,a,div') || first.parentElement;
    const range = document.createRange();
    range.selectNodeContents(block);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'Alt', bubbles:true}));
    return document.querySelectorAll('[data-gv-overlay-part].gv-lens-reveal').length;
  })()`);
  assert.ok(revealedParts > 0);
  await evaluate("document.dispatchEvent(new KeyboardEvent('keyup', {key:'Alt', bubbles:true}))");
  assert.equal(await evaluate("document.querySelectorAll('[data-gv-overlay-part].gv-lens-reveal').length"), 0);

  cdp.close();
  console.log(
    `${directReplay ? "Renderer replay" : "Extension smoke test"} passed: ` +
    `${(coverage * 100).toFixed(1)}% eligible-text coverage, exclusions, full-word anchors, indicator, ` +
    `selected-area peek${longPageDurationMs !== null
      ? `, 2,000-message Greek overlay rendering in ${longPageDurationMs.toFixed(1)} ms, ` +
        `and SPA soak p95 ${spaSoakP95Ms.toFixed(1)} ms`
      : ""}.`
  );
} catch (error) {
  console.error(chromeErrors.slice(-4000));
  throw error;
} finally {
  chrome.kill("SIGTERM");
  server.close();
  await rm(profilePath, { recursive: true, force: true });
}
