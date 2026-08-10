(() => {
  "use strict";

  const Core = globalThis.GreekVeilCore;
  const State = globalThis.GreekVeilState;
  const Gregg = globalThis.GreekVeilGregg;
  if (!Core?.transform || !Core?.getPack || !State?.migrateSettings ||
      !State?.resolveEffectiveState) {
    console.error(
      "[Kalima] The shared runtime did not initialize. " +
      "The page was left unchanged; reload Kalima and then reload this tab."
    );
    return;
  }
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "KBD", "SAMP",
    "TEXTAREA", "INPUT", "SELECT", "OPTION", "SVG", "MATH", "CANVAS"
  ]);
  const SKIP_SELECTOR = "script,style,noscript,code,pre,kbd,samp,textarea,input,select,option,svg,math,canvas";
  const OWNED_SELECTOR = "[data-gv-ui], [data-gv-overlay-part]";
  const EDITABLE_CONTROL_SELECTOR =
    "[contenteditable='true'],[contenteditable=''],[contenteditable='plaintext-only']";
  const TEXT_CONTROL_SELECTOR =
    `textarea,input[type='text'],input[type='search'],input[type='email'],` +
    `input[type='url'],input[type='tel'],input:not([type]),${EDITABLE_CONTROL_SELECTOR}`;
  const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel"]);
  const SHADOW_AUDIT_INTERVAL_MS = 30_000;
  const SHADOW_AUDIT_SLICE_SIZE = 300;
  const GOOGLE_DOCS_STATE_CHANNEL = "kalima-google-docs-state-v1";
  const GOOGLE_DOCS_STATUS_CHANNEL = "kalima-google-docs-status-v1";
  const INPUT_MIRROR_PROPERTIES = [
    "font-family", "font-size", "font-style", "font-weight", "font-stretch",
    "font-variant", "letter-spacing", "line-height", "opacity", "text-align", "text-indent",
    "text-transform", "direction", "tab-size", "padding-top", "padding-right",
    "padding-bottom", "padding-left", "border-top-width", "border-right-width",
    "border-bottom-width", "border-left-width", "border-radius"
  ];
  const BLOCK_SELECTOR = "p,li,blockquote,article,section,td,th,dd,dt,h1,h2,h3,h4,h5,h6,figcaption,button,a,div";
  const SHADOW_STYLE = `
    [data-gv-overlay-part]{position:relative!important;color:transparent!important;
      -webkit-text-fill-color:transparent!important;text-shadow:none!important}
    [data-gv-overlay-part]::after{content:attr(data-gv-rendered);position:absolute;
      inset-inline-start:0;top:0;color:var(--gv-ink,#222);-webkit-text-fill-color:var(--gv-ink,#222);
      font:inherit;font-size:calc(1em * var(--greek-veil-scale,1));
      letter-spacing:var(--greek-veil-letter-spacing,inherit);line-height:inherit;
      white-space:pre;direction:ltr;unicode-bidi:isolate-override;pointer-events:none}
    [data-gv-overlay-part].gv-lens-reveal,[data-gv-overlay-part].gv-learning-hint{
      color:var(--gv-ink,#222)!important;-webkit-text-fill-color:var(--gv-ink,#222)!important}
    [data-gv-overlay-part].gv-lens-reveal::after,[data-gv-overlay-part].gv-learning-hint::after{opacity:0!important}
    [data-gv-overlay-part].gv-stroke::after{content:none!important}
    [data-gv-stroke-svg]{position:absolute;inset-inline-start:0;top:.08em;width:100%;height:.94em;
      overflow:visible;pointer-events:none;color:var(--gv-ink,#222)}
    [data-gv-overlay-part].gv-lens-reveal>[data-gv-stroke-svg],
    [data-gv-overlay-part].gv-learning-hint>[data-gv-stroke-svg]{opacity:0!important}
    .gv-input-source-hidden{color:transparent!important;-webkit-text-fill-color:transparent!important;
      text-shadow:none!important;caret-color:var(--gv-input-caret,currentColor)!important}`;

  const unicodeOriginals = new WeakMap();
  const unicodeRendered = new WeakMap();
  const unicodeNodes = new Set();
  const overlayGroups = new Set();
  const observedRoots = new WeakSet();
  const lensParts = new Set();
  const wordOffsets = new WeakMap();
  const inputMirrors = new Map();
  const composingInputs = new WeakSet();
  const watchedTextControls = new WeakSet();

  let resolved = null;
  let currentPack = null;
  let observer = null;
  let applying = false;
  let revealElement = null;
  let revealTimer = null;
  let indicatorHost = null;
  let groupSequence = 0;
  let lastPointer = { x: 0, y: 0 };
  let holdingRevealKey = false;
  let revealFollowsPointer = false;
  let inactivityTimer = null;
  let inputLayoutFrame = 0;
  let inputMonitorTimer = null;
  let shadowAuditTimer = null;
  let shadowAuditHandle = null;
  let shadowAuditUsesIdleCallback = false;
  let shadowAuditWalker = null;
  let documentParsed = document.readyState !== "loading";
  let nextWordOffset = 0;
  let googleDocsStatus = null;
  const isTopFrame = window === window.top;
  const isGoogleDocsDocument = isTopFrame &&
    location.hostname === "docs.google.com" &&
    location.pathname.startsWith("/document/");
  const automationReasons = new Set();
  const sessionSeed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;

  const diagnostics = {
    startedAt: Date.now(),
    renderer: "",
    packId: "",
    profileId: "",
    clearWordFraction: 0,
    transformedNodes: 0,
    overlayGroups: 0,
    mutations: 0,
    mutationBatches: 0,
    mutationRoots: 0,
    walks: 0,
    walkedTextNodes: 0,
    lastWalkMs: 0,
    maxWalkMs: 0,
    excludedNodes: 0,
    shadowRoots: 0,
    shadowAuditPasses: 0,
    shadowAuditElements: 0,
    shadowAuditMaxSliceMs: 0,
    inputMirrors: 0,
    googleDocs: null,
    errors: [],
    degraded: []
  };

  function recordError(error) {
    const message = error?.message || String(error);
    diagnostics.errors.push(message.slice(0, 200));
    diagnostics.errors = diagnostics.errors.slice(-10);
  }

  function veilActive() {
    return Boolean(resolved?.effective?.enabled || automationReasons.size);
  }

  function syncGoogleDocsCanvasAdapter() {
    if (!isGoogleDocsDocument || !resolved || !currentPack) return;
    const sensitivePack = resolved.effective.sensitiveMode === "pack"
      ? Core.getPack(
        resolved.effective.sensitivePackId,
        resolved.settings?.customPacks || []
      )
      : null;
    window.postMessage({
      channel: GOOGLE_DOCS_STATE_CHANNEL,
      state: {
        enabled: veilActive(),
        renderer: resolved.effective.renderer,
        packId: currentPack.id,
        pack: currentPack,
        profileId: resolved.effective.profileId,
        sensitiveMode: resolved.effective.sensitiveMode,
        sensitivePackId: sensitivePack?.id || "",
        sensitivePack,
        clearWordFraction: resolved.effective.clearWordFraction,
        sessionVariation: resolved.effective.sessionVariation,
        sessionSeed,
        letterSpacing: resolved.effective.letterSpacing
      }
    }, location.origin);
  }

  function googleDocsWarnings() {
    if (!isGoogleDocsDocument) return [];
    const warnings = [];
    if (googleDocsStatus?.reloadRequired) {
      warnings.push(
        "Google Docs painted its canvas before the current settings arrived or changed; reload the document to redraw it."
      );
    }
    if (googleDocsStatus?.detected && !googleDocsStatus.supported) {
      warnings.push(
        "The selected renderer is unavailable on Google Docs canvas; document text remains clear."
      );
    }
    return warnings;
  }

  function isEditable(element) {
    if (!(element instanceof Element)) return false;
    return element.isContentEditable ||
      Boolean(element.closest("[contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']")) ||
      document.designMode === "on";
  }

  function isEligible(node) {
    const parent = node.parentElement;
    if (!parent || !veilActive()) return false;
    if (parent.closest(OWNED_SELECTOR)) return false;
    if (SKIP_TAGS.has(parent.tagName) || isEditable(parent)) {
      diagnostics.excludedNodes += 1;
      return false;
    }
    if (parent.closest(SKIP_SELECTOR)) {
      diagnostics.excludedNodes += 1;
      return false;
    }
    return true;
  }

  function profileFor() {
    return resolved.effective.profileId;
  }

  function looksSensitive(text) {
    if (!text || resolved.effective.sensitiveMode === "off") return false;
    return /(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\p{Sc}\s?\d|\b(?:\d[ -]?){8,}\d\b)/u.test(text);
  }

  function transformText(text, node, profileId = profileFor(node), clearWordRanges = null, wordOffset = 0) {
    let pack = currentPack;
    let selectedProfile = profileId;
    if (looksSensitive(text)) {
      if (resolved.effective.sensitiveMode === "pack") {
        const candidate = Core.getPack(resolved.effective.sensitivePackId, resolved.settings?.customPacks || []);
        if (candidate.renderers.includes(resolved.effective.renderer)) {
          pack = candidate;
          selectedProfile = candidate.profiles.dense ? "dense" : candidate.defaultProfile;
        } else if (currentPack.profiles.dense) {
          selectedProfile = "dense";
        }
      } else if (currentPack.profiles.dense) {
        selectedProfile = "dense";
      }
    }
    const options = {
      variationSeed: resolved.effective.sessionVariation ? sessionSeed : 0,
      wordSeed: sessionSeed,
      wordOffset,
      clearWordFraction: resolved.effective.clearWordFraction
    };
    if (Array.isArray(clearWordRanges)) options.clearWordRanges = clearWordRanges;
    return Core.transform(text, pack, selectedProfile, options);
  }

  function isInsideReveal(node) {
    return Boolean(revealElement && revealElement.contains(node.parentElement));
  }

  function wordOffsetFor(node, text) {
    if (!resolved?.effective?.clearWordFraction) return 0;
    const existing = wordOffsets.get(node);
    if (existing !== undefined) return existing;
    const offset = nextWordOffset;
    wordOffsets.set(node, offset);
    nextWordOffset += Core.countClearWordCandidates(text);
    return offset;
  }

  function transformUnicodeNode(node, eligibilityKnown = false) {
    if ((!eligibilityKnown && !isEligible(node)) || isInsideReveal(node)) return;
    const current = node.nodeValue || "";
    const priorRendered = unicodeRendered.get(node);
    if (priorRendered !== undefined && current === priorRendered) return;
    const transformed = transformText(current, node, profileFor(node), null, wordOffsetFor(node, current));
    if (transformed === current) return;
    unicodeOriginals.set(node, current);
    unicodeRendered.set(node, transformed);
    unicodeNodes.add(node);
    diagnostics.transformedNodes += 1;
    node.nodeValue = transformed;
  }

  function restoreUnicode(root = null) {
    for (const node of [...unicodeNodes]) {
      if (!node.isConnected) {
        unicodeNodes.delete(node);
        continue;
      }
      if (root && !root.contains(node.parentElement)) continue;
      const original = unicodeOriginals.get(node);
      const rendered = unicodeRendered.get(node);
      if (original !== undefined && node.nodeValue === rendered) node.nodeValue = original;
      unicodeRendered.delete(node);
      unicodeNodes.delete(node);
    }
  }

  function makeOverlayPart(source, groupId, profileId, clearWordRanges, inkColor) {
    const part = document.createElement("span");
    part.dataset.gvOverlayPart = "";
    part.dataset.gvGroup = groupId;
    part.textContent = source;
    part.dataset.gvRendered = transformText(source, null, profileId, clearWordRanges);
    if (clearWordRanges.length) part.dataset.gvClearRanges = JSON.stringify(clearWordRanges);
    part.style.setProperty("--gv-ink", inkColor || "currentColor");
    return part;
  }

  function createStrokeSvg(source) {
    const outline = Gregg?.outlineWord(source);
    if (!outline) return null;
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.dataset.gvStrokeSvg = "";
    svg.setAttribute("viewBox", outline.viewBox);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const segment of outline.paths) {
      const path = document.createElementNS(namespace, "path");
      path.setAttribute("d", segment.d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "var(--gv-ink, #222)");
      path.setAttribute("stroke-width", String(segment.width));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("vector-effect", "non-scaling-stroke");
      svg.append(path);
    }
    return svg;
  }

  function updateStrokePart(part, source, clear) {
    part.querySelector(":scope > [data-gv-stroke-svg]")?.remove();
    part.classList.remove("gv-stroke");
    part.dataset.gvClearWord = clear ? "true" : "false";
    part.dataset.gvRendered = source;
    if (clear || !/[A-Za-z]/.test(source)) return;
    const svg = createStrokeSvg(source);
    if (!svg) return;
    part.classList.add("gv-stroke");
    part.dataset.gvRendered = "Gregg Simplified outline";
    part.append(svg);
  }

  function isVeilableTextControl(control) {
    if (control instanceof HTMLTextAreaElement) return !control.closest("[data-gv-ui]");
    if (control instanceof HTMLInputElement) {
      return TEXT_INPUT_TYPES.has((control.type || "text").toLowerCase()) &&
        !control.closest("[data-gv-ui]");
    }
    return control instanceof HTMLElement &&
      control.matches(EDITABLE_CONTROL_SELECTOR) &&
      !control.closest("[data-gv-ui]");
  }

  function isContentEditableTextControl(control) {
    return control instanceof HTMLElement && control.matches(EDITABLE_CONTROL_SELECTOR);
  }

  function textControlValue(control) {
    if (!isContentEditableTextControl(control)) return String(control.value || "");
    if (!control.textContent) return "";
    return String(control.innerText || control.textContent || "").replace(/\r\n?/g, "\n");
  }

  function textControlFocused(control) {
    return control.matches(":focus") || control.contains(document.activeElement);
  }

  function textControlSelectionStart(control, value = textControlValue(control)) {
    if (!isContentEditableTextControl(control)) {
      try {
        return Number(control.selectionStart);
      } catch {
        return value.length;
      }
    }
    if (!textControlFocused(control)) return -1;
    const selection = window.getSelection();
    const focusNode = selection?.focusNode;
    if (!selection || !focusNode || !control.contains(focusNode)) return value.length;
    try {
      const beforeCaret = document.createRange();
      beforeCaret.selectNodeContents(control);
      beforeCaret.setEnd(focusNode, selection.focusOffset);
      return Math.min(value.length, beforeCaret.toString().replace(/\r\n?/g, "\n").length);
    } catch {
      return value.length;
    }
  }

  function watchTextControl(control) {
    if (!isVeilableTextControl(control) || watchedTextControls.has(control)) return;
    watchedTextControls.add(control);
    for (const eventName of ["beforeinput", "input", "change", "focus", "blur", "click", "keyup", "select"]) {
      control.addEventListener(eventName, () => {
        queueMicrotask(() => syncInputMirror(control));
      });
    }
    control.addEventListener("compositionstart", () => {
      composingInputs.add(control);
      removeInputMirror(control);
    });
    control.addEventListener("compositionend", () => {
      composingInputs.delete(control);
      queueMicrotask(() => syncInputMirror(control));
    });
    control.addEventListener("scroll", () => {
      syncInputMirror(control);
      scheduleInputMirrorLayout();
    }, { passive: true });
  }

  function removeInputMirror(control) {
    const entry = inputMirrors.get(control);
    if (!entry) return;
    entry.mirror.remove();
    control.classList.remove("gv-input-source-hidden");
    control.style.removeProperty("--gv-input-caret");
    inputMirrors.delete(control);
    diagnostics.inputMirrors = inputMirrors.size;
  }

  function restoreInputMirrors() {
    for (const control of [...inputMirrors.keys()]) removeInputMirror(control);
  }

  function inputValueParts(value, control, caret = textControlSelectionStart(control, value)) {
    const raw = String(value || "");
    const tokens = [...raw.matchAll(/\s+|[^\s]+/g)].map((match) => ({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      whitespace: /^\s+$/.test(match[0])
    }));
    return tokens.map((token, index) => {
      const followedBySpace = !token.whitespace && Boolean(tokens[index + 1]?.whitespace);
      const active = caret >= token.start && caret <= token.end;
      return { ...token, veil: followedBySpace && !active };
    });
  }

  function appendInputPart(mirror, control, part) {
    if (!part.veil) {
      mirror.append(document.createTextNode(part.text));
      return;
    }
    if (resolved.effective.renderer !== "strokes") {
      const word = document.createElement("span");
      word.dataset.gvInputWord = "";
      word.textContent = transformText(part.text, control, profileFor(control), []);
      mirror.append(word);
      return;
    }
    const word = document.createElement("span");
    word.dataset.gvInputWord = "";
    word.className = "gv-stroke";
    word.textContent = part.text;
    const svg = createStrokeSvg(part.text);
    if (svg) word.append(svg);
    else word.classList.remove("gv-stroke");
    mirror.append(word);
  }

  function positionInputMirror(entry) {
    const { control, mirror } = entry;
    if (!control.isConnected || !entry.value) {
      if (!control.isConnected) removeInputMirror(control);
      else mirror.hidden = true;
      return;
    }
    const rect = control.getBoundingClientRect();
    const computed = getComputedStyle(control);
    mirror.hidden = rect.width <= 0 || rect.height <= 0 || computed.visibility === "hidden";
    if (mirror.hidden) return;
    mirror.style.left = `${rect.left}px`;
    mirror.style.top = `${rect.top}px`;
    mirror.style.width = `${rect.width}px`;
    mirror.style.height = `${rect.height}px`;
    for (const property of INPUT_MIRROR_PROPERTIES) {
      mirror.style.setProperty(property, computed.getPropertyValue(property));
    }
    mirror.style.borderStyle = "solid";
    mirror.style.borderColor = "transparent";
    const multiline = control instanceof HTMLTextAreaElement || isContentEditableTextControl(control);
    mirror.style.whiteSpace = multiline ? "pre-wrap" : "pre";
    mirror.style.overflowWrap = multiline ? "break-word" : "normal";
    mirror.style.wordBreak = "normal";
    mirror.scrollTop = control.scrollTop;
    mirror.scrollLeft = control.scrollLeft;
  }

  function syncInputMirror(control) {
    if (!isVeilableTextControl(control)) {
      removeInputMirror(control);
      return;
    }
    watchTextControl(control);
    const value = textControlValue(control);
    if (!resolved?.effective?.veilTextInputs || !veilActive() ||
        composingInputs.has(control) || !value) {
      removeInputMirror(control);
      return;
    }

    let entry = inputMirrors.get(control);
    if (!entry) {
      const computed = getComputedStyle(control);
      const mirror = document.createElement("div");
      mirror.dataset.gvUi = "";
      mirror.dataset.gvInputMirror = isContentEditableTextControl(control)
        ? "contenteditable"
        : "form-control";
      mirror.setAttribute("aria-hidden", "true");
      mirror.style.setProperty("--gv-input-ink", computed.color || "currentColor");
      mirror.style.setProperty("--gv-ink", computed.color || "currentColor");
      control.style.setProperty("--gv-input-caret", computed.color || "currentColor");
      document.documentElement.append(mirror);
      entry = { control, mirror, value: "", selectionStart: -1 };
      inputMirrors.set(control, entry);
    }

    const selectionStart = textControlSelectionStart(control, value);
    const focused = textControlFocused(control);
    if (entry.value !== value || entry.selectionStart !== selectionStart ||
        entry.focused !== focused) {
      entry.value = value;
      entry.selectionStart = selectionStart;
      entry.focused = focused;
      entry.mirror.replaceChildren();
      for (const part of inputValueParts(value, control, selectionStart)) {
        appendInputPart(entry.mirror, control, part);
      }
    }
    control.classList.add("gv-input-source-hidden");
    positionInputMirror(entry);
    diagnostics.inputMirrors = inputMirrors.size;
  }

  function syncInputMirrors(root = document) {
    if (!documentParsed || !resolved?.effective?.veilTextInputs || !veilActive()) {
      restoreInputMirrors();
      return;
    }
    const controls = [];
    if (isVeilableTextControl(root)) controls.push(root);
    if (root?.querySelectorAll) {
      controls.push(...root.querySelectorAll(TEXT_CONTROL_SELECTOR));
    }
    for (const control of controls) syncInputMirror(control);
    for (const control of [...inputMirrors.keys()]) {
      if (!control.isConnected) removeInputMirror(control);
    }
  }

  function scheduleInputMirrorLayout() {
    if (inputLayoutFrame) return;
    inputLayoutFrame = requestAnimationFrame(() => {
      inputLayoutFrame = 0;
      for (const entry of inputMirrors.values()) positionInputMirror(entry);
    });
  }

  function activeTextControl() {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (isVeilableTextControl(active)) return active;
    const editable = active?.closest?.(EDITABLE_CONTROL_SELECTOR);
    return isVeilableTextControl(editable) ? editable : null;
  }

  function inputControlNeedsSync(control) {
    const entry = inputMirrors.get(control);
    const value = textControlValue(control);
    if (!entry) return Boolean(value);
    const selectionStart = textControlSelectionStart(control, value);
    return entry.value !== value ||
      entry.selectionStart !== selectionStart ||
      entry.focused !== textControlFocused(control);
  }

  function scheduleInputMonitor(delay = 0) {
    clearTimeout(inputMonitorTimer);
    inputMonitorTimer = null;
    if (!documentParsed || document.hidden || !resolved?.effective?.veilTextInputs || !veilActive()) return;
    inputMonitorTimer = setTimeout(() => {
      inputMonitorTimer = null;
      const control = activeTextControl();
      if (control && inputControlNeedsSync(control)) syncInputMirror(control);
      scheduleInputMonitor(control ? 50 : 250);
    }, delay);
  }

  function makeStrokePart(source, groupId, clear, inkColor) {
    const part = document.createElement("span");
    part.dataset.gvOverlayPart = "";
    part.dataset.gvStrokePart = "";
    part.dataset.gvGroup = groupId;
    part.append(document.createTextNode(source));
    part.style.setProperty("--gv-ink", inkColor || "currentColor");
    updateStrokePart(part, source, clear);
    return part;
  }

  function transformStrokeNode(node, eligibilityKnown = false, inheritedInkColor = null) {
    if ((!eligibilityKnown && !isEligible(node)) || isInsideReveal(node)) return;
    const source = node.nodeValue || "";
    if (!/[A-Za-z]/.test(source) || !Gregg) return;

    const wordOffset = wordOffsetFor(node, source);
    const clearRanges = Core.selectClearWordRanges(
      source,
      resolved.effective.clearWordFraction,
      sessionSeed,
      wordOffset
    );
    const groupId = `g${++groupSequence}`;
    const tokens = source.match(/\s+|[A-Za-z]+(?:['’][A-Za-z]+)*|[^A-Za-z\s]+/g) || [source];
    const inkColor = inheritedInkColor || getComputedStyle(node.parentElement).color;
    let tokenOffset = 0;
    const parts = tokens.map((token) => {
      const start = tokenOffset;
      const end = start + token.length;
      tokenOffset = end;
      const clear = clearRanges.some((range) => range.start === start && range.end === end);
      return /[A-Za-z]/.test(token)
        ? makeStrokePart(token, groupId, clear, inkColor)
        : document.createTextNode(token);
    });
    const fragment = document.createDocumentFragment();
    for (const part of parts) fragment.append(part);
    node.replaceWith(fragment);
    overlayGroups.add({ id: groupId, parts });
    diagnostics.transformedNodes += 1;
    diagnostics.overlayGroups = overlayGroups.size;
  }

  function transformOverlayNode(node, eligibilityKnown = false, inheritedInkColor = null) {
    if ((!eligibilityKnown && !isEligible(node)) || isInsideReveal(node)) return;
    const source = node.nodeValue || "";
    if (!/[A-Za-z]/.test(source)) return;
    const profileId = profileFor(node);
    const wordOffset = wordOffsetFor(node, source);
    if (currentPack.id !== "greek" || resolved.effective.sensitiveMode === "pack") {
      const transformed = transformText(source, node, profileId, null, wordOffset);
      if (transformed === source) return;
    }

    const groupId = `g${++groupSequence}`;
    const tokens = source.match(/\s+|[^\s]+/g) || [source];
    const clearRanges = Core.selectClearWordRanges(
      source,
      resolved.effective.clearWordFraction,
      sessionSeed,
      wordOffset
    );
    const inkColor = inheritedInkColor || getComputedStyle(node.parentElement).color;
    let tokenOffset = 0;
    const parts = tokens.map((token) => {
      const start = tokenOffset;
      const end = start + token.length;
      tokenOffset = end;
      if (!/[A-Za-z]/.test(token)) return document.createTextNode(token);
      const localClearRanges = clearRanges
        .filter((range) => range.start >= start && range.end <= end)
        .map((range) => ({ start: range.start - start, end: range.end - start }));
      return makeOverlayPart(token, groupId, profileId, localClearRanges, inkColor);
    });
    const fragment = document.createDocumentFragment();
    for (const part of parts) fragment.append(part);
    node.replaceWith(fragment);
    overlayGroups.add({ id: groupId, parts });
    diagnostics.transformedNodes += 1;
    diagnostics.overlayGroups = overlayGroups.size;
  }

  function restoreOverlay(root = null) {
    for (const group of [...overlayGroups]) {
      const connected = group.parts.filter((part) => part.isConnected);
      if (!connected.length) {
        overlayGroups.delete(group);
        continue;
      }
      if (root && !connected.some((part) => root.contains(part))) continue;
      const sameParent = connected.length === group.parts.length &&
        connected.every((part) => part.parentNode === connected[0].parentNode);
      if (sameParent) {
        const source = connected.map((part) => part.textContent || "").join("");
        connected[0].replaceWith(document.createTextNode(source));
        for (const part of connected.slice(1)) part.remove();
      } else {
        for (const part of connected) part.replaceWith(document.createTextNode(part.textContent || ""));
      }
      overlayGroups.delete(group);
    }
    diagnostics.overlayGroups = overlayGroups.size;
  }

  function transformNode(node, eligibilityKnown = false, inheritedInkColor = null) {
    if (node.nodeType !== Node.TEXT_NODE) return;
    if (resolved.effective.renderer === "overlay") {
      transformOverlayNode(node, eligibilityKnown, inheritedInkColor);
    } else if (resolved.effective.renderer === "strokes") {
      transformStrokeNode(node, eligibilityKnown, inheritedInkColor);
    }
    else transformUnicodeNode(node, eligibilityKnown);
  }

  function registerShadowRoot(root) {
    if (!documentParsed || !root || root.host?.closest?.("[data-gv-ui]") || observedRoots.has(root)) return;
    observedRoots.add(root);
    diagnostics.shadowRoots += 1;
    const style = document.createElement("style");
    style.dataset.gvUi = "";
    style.textContent = SHADOW_STYLE;
    root.prepend(style);
    if (observer) observer.observe(root, { subtree: true, childList: true, characterData: true });
    walk(root);
  }

  function cancelShadowAudit() {
    if (shadowAuditTimer !== null) clearTimeout(shadowAuditTimer);
    shadowAuditTimer = null;
    if (shadowAuditHandle !== null) {
      if (shadowAuditUsesIdleCallback && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(shadowAuditHandle);
      } else {
        clearTimeout(shadowAuditHandle);
      }
    }
    shadowAuditHandle = null;
    shadowAuditWalker = null;
  }

  function queueShadowAuditSlice() {
    if (shadowAuditHandle !== null) return;
    if (typeof requestIdleCallback === "function") {
      shadowAuditUsesIdleCallback = true;
      shadowAuditHandle = requestIdleCallback(runShadowAuditSlice, { timeout: 1000 });
    } else {
      shadowAuditUsesIdleCallback = false;
      shadowAuditHandle = setTimeout(() => {
        runShadowAuditSlice({ didTimeout: true, timeRemaining: () => 0 });
      }, 16);
    }
  }

  function runShadowAuditSlice(deadline) {
    shadowAuditHandle = null;
    if (!documentParsed || document.hidden || !veilActive() || !shadowAuditWalker) {
      shadowAuditWalker = null;
      scheduleShadowAudit();
      return;
    }
    const startedAt = performance.now();
    let processed = 0;
    let finished = false;
    while (processed < SHADOW_AUDIT_SLICE_SIZE) {
      if (processed > 0 && !deadline.didTimeout && deadline.timeRemaining() < 2) break;
      const element = shadowAuditWalker.nextNode();
      if (!element) {
        finished = true;
        break;
      }
      processed += 1;
      if (element.shadowRoot) registerShadowRoot(element.shadowRoot);
    }
    diagnostics.shadowAuditElements += processed;
    diagnostics.shadowAuditMaxSliceMs = Math.max(
      diagnostics.shadowAuditMaxSliceMs,
      Math.round((performance.now() - startedAt) * 10) / 10
    );
    if (finished) {
      diagnostics.shadowAuditPasses += 1;
      shadowAuditWalker = null;
      scheduleShadowAudit();
    } else {
      queueShadowAuditSlice();
    }
  }

  function scheduleShadowAudit(delay = SHADOW_AUDIT_INTERVAL_MS) {
    if (!documentParsed || document.hidden || !veilActive() ||
        shadowAuditTimer !== null || shadowAuditHandle !== null || shadowAuditWalker) {
      return;
    }
    shadowAuditTimer = setTimeout(() => {
      shadowAuditTimer = null;
      if (!document.documentElement || document.hidden || !veilActive()) {
        scheduleShadowAudit();
        return;
      }
      shadowAuditWalker = document.createTreeWalker(
        document.documentElement,
        NodeFilter.SHOW_ELEMENT
      );
      queueShadowAuditSlice();
    }, delay);
  }

  function walk(root) {
    if (!documentParsed || !root || !veilActive()) return;
    if (root.nodeType === Node.TEXT_NODE) {
      transformNode(root);
      return;
    }
    if (root instanceof Element && root.closest(OWNED_SELECTOR)) return;
    const startedAt = performance.now();
    syncInputMirrors(root);
    if (document.designMode === "on") return;
    if (root instanceof Element &&
        (SKIP_TAGS.has(root.tagName) || isEditable(root) || root.closest(SKIP_SELECTOR))) {
      // Text controls are synchronized above, but their source text and all
      // other excluded subtrees must remain untouched.
      return;
    }

    const nodes = [];
    const shadowRoots = [];
    if (root instanceof Element && root.shadowRoot) shadowRoots.push(root.shadowRoot);
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(candidate) {
          if (candidate.nodeType === Node.ELEMENT_NODE) {
            if (candidate.shadowRoot) shadowRoots.push(candidate.shadowRoot);
            if (candidate.matches(OWNED_SELECTOR) ||
                SKIP_TAGS.has(candidate.tagName) ||
                candidate.isContentEditable) {
              diagnostics.excludedNodes += 1;
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_SKIP;
          }
          return candidate.parentElement ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) nodes.push(node);
    }
    const inkColors = new WeakMap();
    if (resolved.effective.renderer !== "unicode") {
      // Read inherited colors before any renderer DOM writes. Interleaving
      // getComputedStyle with thousands of replacements can force repeated
      // style recalculation on long pages.
      for (const textNode of nodes) {
        const parent = textNode.parentElement;
        if (parent && !inkColors.has(parent)) {
          inkColors.set(parent, getComputedStyle(parent).color || "currentColor");
        }
      }
    }
    // Overlay rendering replaces text nodes. Transform only after snapshotting
    // the traversal so DOM surgery cannot make TreeWalker skip later branches.
    for (const textNode of nodes) {
      transformNode(textNode, true, inkColors.get(textNode.parentElement));
    }
    for (const shadowRoot of shadowRoots) registerShadowRoot(shadowRoot);
    const durationMs = performance.now() - startedAt;
    diagnostics.walks += 1;
    diagnostics.walkedTextNodes += nodes.length;
    diagnostics.lastWalkMs = Math.round(durationMs * 10) / 10;
    diagnostics.maxWalkMs = Math.max(diagnostics.maxWalkMs, diagnostics.lastWalkMs);
  }

  function clearRendering() {
    applying = true;
    clearTimeout(inputMonitorTimer);
    inputMonitorTimer = null;
    cancelShadowAudit();
    restoreUnicode();
    restoreOverlay();
    restoreInputMirrors();
    queueMicrotask(() => { applying = false; });
  }

  function setRevealElement(element) {
    if (revealElement === element) return;
    const prior = revealElement;
    revealElement = element;
    if (resolved?.effective?.renderer !== "unicode") {
      for (const part of lensParts) {
        part.classList.remove("gv-lens-reveal");
      }
      lensParts.clear();
      if (element) {
        for (const part of element.querySelectorAll("[data-gv-overlay-part]")) {
          part.classList.add("gv-lens-reveal");
          lensParts.add(part);
        }
      }
    } else {
      if (element) restoreUnicode(element);
      if (prior) walk(prior);
    }
    updateIndicator();
  }

  function selectedBlock() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const common = selection.getRangeAt(0).commonAncestorContainer;
    const element = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
    return element?.closest?.(BLOCK_SELECTOR) || element || null;
  }

  function pointerBlock() {
    const target = document.elementFromPoint(lastPointer.x, lastPointer.y);
    return target?.closest?.(BLOCK_SELECTOR) || null;
  }

  function peekElement(element, durationMs = 0) {
    clearTimeout(revealTimer);
    setRevealElement(element);
    if (element && durationMs > 0) {
      revealTimer = setTimeout(() => setRevealElement(null), durationMs);
    }
  }

  function cleanupRemoved(root) {
    if (root.nodeType === Node.TEXT_NODE) unicodeNodes.delete(root);
    if (root instanceof Element) {
      if (isVeilableTextControl(root)) removeInputMirror(root);
      for (const control of root.querySelectorAll(`textarea,input,${EDITABLE_CONTROL_SELECTOR}`)) {
        removeInputMirror(control);
      }
      for (const node of root.querySelectorAll("*")) {
        if (node.firstChild?.nodeType === Node.TEXT_NODE) unicodeNodes.delete(node.firstChild);
      }
    }
    for (const group of [...overlayGroups]) {
      if (!group.parts.some((part) => part.isConnected)) overlayGroups.delete(group);
    }
    diagnostics.overlayGroups = overlayGroups.size;
  }

  function minimalMutationRoots(nodes, connected) {
    const candidates = new Set([...nodes].filter((node) => node.isConnected === connected));
    const roots = [];
    for (const candidate of candidates) {
      let ancestor = candidate.parentNode;
      let covered = false;
      while (ancestor) {
        if (candidates.has(ancestor)) {
          covered = true;
          break;
        }
        ancestor = ancestor.parentNode;
      }
      if (!covered) roots.push(candidate);
    }
    return roots;
  }

  function isWithinRoots(node, roots) {
    return roots.some((root) => root === node || root.contains?.(node));
  }

  function handleCharacterMutation(node) {
    const priorRendered = unicodeRendered.get(node);
    if (priorRendered !== undefined && node.nodeValue === priorRendered) return;
    const wrapper = node.parentElement?.closest("[data-gv-overlay-part]");
    if (wrapper) {
      if (wrapper.hasAttribute("data-gv-stroke-part")) {
        updateStrokePart(
          wrapper,
          node.nodeValue || "",
          wrapper.dataset.gvClearWord === "true"
        );
        return;
      }
      let clearWordRanges = [];
      try {
        clearWordRanges = JSON.parse(wrapper.dataset.gvClearRanges || "[]");
      } catch {
        clearWordRanges = [];
      }
      wrapper.dataset.gvRendered = transformText(
        node.nodeValue || "",
        wrapper,
        profileFor(wrapper),
        clearWordRanges
      );
      return;
    }
    transformNode(node);
  }

  function processMutationBatch(mutations, counted = false) {
    if (!documentParsed || !veilActive()) return;
    if (!counted) {
      diagnostics.mutations += mutations.length;
      diagnostics.mutationBatches += 1;
    }
    if (applying) {
      queueMicrotask(() => processMutationBatch(mutations, true));
      return;
    }
    const changedNodes = new Set();
    const addedNodes = new Set();
    const removedNodes = new Set();
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        changedNodes.add(mutation.target);
        continue;
      }
      for (const removed of mutation.removedNodes) removedNodes.add(removed);
      for (const added of mutation.addedNodes) addedNodes.add(added);
    }

    const removals = minimalMutationRoots(removedNodes, false);
    const additions = minimalMutationRoots(addedNodes, true);
    diagnostics.mutationRoots += removals.length + additions.length;
    for (const removed of removals) cleanupRemoved(removed);
    for (const changed of changedNodes) {
      if (!changed.isConnected ||
          isWithinRoots(changed, removals) ||
          isWithinRoots(changed, additions)) {
        continue;
      }
      handleCharacterMutation(changed);
    }
    for (const added of additions) walk(added);
  }

  function observe() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      processMutationBatch(mutations);
    });
    observer.observe(document, { subtree: true, childList: true, characterData: true });
    observedRoots.add(document);
  }

  function createIndicator() {
    if (!isTopFrame || indicatorHost?.isConnected || !document.documentElement) return;
    indicatorHost = document.createElement("div");
    indicatorHost.dataset.gvUi = "";
    indicatorHost.id = "gv-indicator-host";
    const shadow = indicatorHost.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host{all:initial;position:fixed;z-index:2147483647;right:12px;bottom:12px;pointer-events:none}
        #pill{font:600 11px/1.2 system-ui,sans-serif;color:#fff;background:#32275f;
          border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:5px 8px;
          box-shadow:0 2px 8px rgba(0,0,0,.28);opacity:.82}
        #pill.reveal{background:#9b5c18} #pill.off{background:#555}
      </style>
      <div id="pill" role="status" aria-live="polite"></div>`;
    document.documentElement.append(indicatorHost);
  }

  function updateIndicator() {
    if (!documentParsed || !resolved) return;
    if (!resolved.effective.showIndicator) {
      indicatorHost?.remove();
      indicatorHost = null;
      return;
    }
    createIndicator();
    const pill = indicatorHost?.shadowRoot?.getElementById("pill");
    if (!pill) return;
    const enabled = veilActive();
    pill.className = revealElement ? "reveal" : enabled ? "" : "off";
    pill.textContent = googleDocsStatus?.reloadRequired ? "KALIMA · RELOAD DOCS" :
      revealElement ? "KALIMA · PEEK" :
      automationReasons.size ? `KALIMA · AUTO ${currentPack?.name || ""}` :
        enabled ? `KALIMA · ${currentPack?.name || ""}` : "KALIMA · OFF";
  }

  function setAutomationReason(reason, enabled) {
    const wasActive = veilActive();
    if (enabled) automationReasons.add(reason);
    else automationReasons.delete(reason);
    const isActive = veilActive();
    if (wasActive !== isActive) {
      clearRendering();
      if (isActive) {
        walk(document.documentElement);
        scheduleShadowAudit();
      }
      scheduleInputMonitor();
    }
    syncGoogleDocsCanvasAdapter();
    updateIndicator();
  }

  function resetInactivity() {
    clearTimeout(inactivityTimer);
    setAutomationReason("inactive", false);
    const minutes = resolved?.effective?.autoVeilAfterMinutes || 0;
    if (minutes > 0) {
      inactivityTimer = setTimeout(() => setAutomationReason("inactive", true), minutes * 60 * 1000);
    }
  }

  function applyResolved(payload) {
    if (!payload?.effective || !payload?.pack) return;
    const priorSignature = resolved ? JSON.stringify([
      resolved.effective.enabled,
      resolved.effective.packId,
      resolved.effective.profileId,
      resolved.effective.renderer,
      resolved.effective.clearWordFraction,
      resolved.effective.sessionVariation,
      resolved.effective.sensitiveMode,
      resolved.effective.sensitivePackId,
      resolved.effective.glyphScale,
      resolved.effective.letterSpacing,
      resolved.effective.veilTextInputs
    ]) : "";
    const nextSignature = JSON.stringify([
      payload.effective.enabled,
      payload.effective.packId,
      payload.effective.profileId,
      payload.effective.renderer,
      payload.effective.clearWordFraction,
      payload.effective.sessionVariation,
      payload.effective.sensitiveMode,
      payload.effective.sensitivePackId,
      payload.effective.glyphScale,
      payload.effective.letterSpacing,
      payload.effective.veilTextInputs
    ]);
    if (priorSignature !== nextSignature) clearRendering();
    resolved = payload;
    currentPack = payload.pack;
    diagnostics.renderer = resolved.effective.renderer;
    diagnostics.packId = currentPack.id;
    diagnostics.profileId = resolved.effective.profileId;
    diagnostics.clearWordFraction = resolved.effective.clearWordFraction;
    diagnostics.degraded = resolved.effective.renderer === "unicode"
      ? ["Unicode mode changes visible DOM text while active; restoration uses captured page source."]
      : resolved.effective.renderer === "strokes"
        ? [
          "Gregg Simplified outlines are experimental phonetic approximations.",
          "Stroke overlay preserves source text but may wrap text-node structure on fragile pages."
        ]
        : ["Visual overlay preserves source text but may wrap text-node structure on fragile pages."];
    if (resolved.effective.sensitiveMode === "pack") {
      const sensitivePack = Core.getPack(
        resolved.effective.sensitivePackId,
        resolved.settings?.customPacks || []
      );
      if (!sensitivePack.renderers.includes(resolved.effective.renderer)) {
        diagnostics.degraded.push(
          `${sensitivePack.name} cannot render sensitive-looking text in ` +
          `${resolved.effective.renderer} mode; the current pack's Dense profile is used instead.`
        );
      }
    }
    if (isGoogleDocsDocument && resolved.effective.renderer === "strokes") {
      diagnostics.degraded.push(
        "Google Docs canvas cannot display connected strokes; its document text remains clear."
      );
    }
    if (!resolved.effective.autoVeilOnBlur) setAutomationReason("blur", false);
    resetInactivity();
    syncGoogleDocsCanvasAdapter();
    syncDocumentPresentation();
  }

  function syncDocumentPresentation() {
    if (!documentParsed || !resolved || !document.documentElement) return;
    document.documentElement.style.setProperty("--greek-veil-scale", String(resolved.effective.glyphScale || 1));
    document.documentElement.style.setProperty("--greek-veil-letter-spacing", `${resolved.effective.letterSpacing || 0}px`);
    if (veilActive()) {
      walk(document.documentElement);
      scheduleShadowAudit();
    } else {
      cancelShadowAudit();
    }
    syncInputMirrors(document);
    scheduleInputMonitor();
    updateIndicator();
  }

  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "The extension did not respond.");
    return response.value;
  }

  async function refreshState() {
    try {
      applyResolved(await send({ type: "gv-get-state", url: location.href }));
    } catch (error) {
      recordError(error);
      const stored = await chrome.storage.local.get([State.SETTINGS_KEY, "enabled"]);
      const rawSettings = stored[State.SETTINGS_KEY] ??
        (typeof stored.enabled === "boolean" ? { enabled: stored.enabled } : {});
      const settings = State.migrateSettings(rawSettings);
      const effective = State.resolveEffectiveState(settings, {}, location.href);
      const pack = Core.getPack(effective.packId, settings.customPacks);
      effective.renderer = Core.resolveRenderer(pack, effective.renderer);
      applyResolved({ effective, pack, settings });
    }
  }

  function activeElementIsEditable() {
    return isEditable(document.activeElement) || ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  }

  function eventTextControl(event) {
    return event.composedPath?.().find((target) => isVeilableTextControl(target)) || null;
  }

  for (const eventName of ["beforeinput", "input", "change", "focusin", "focusout", "click", "keyup", "select"]) {
    document.addEventListener(eventName, (event) => {
      const control = eventTextControl(event);
      if (!control) return;
      queueMicrotask(() => syncInputMirror(control));
    }, true);
  }

  document.addEventListener("compositionstart", (event) => {
    const control = eventTextControl(event);
    if (!control) return;
    composingInputs.add(control);
    removeInputMirror(control);
  }, true);

  document.addEventListener("compositionend", (event) => {
    const control = eventTextControl(event);
    if (!control) return;
    composingInputs.delete(control);
    queueMicrotask(() => syncInputMirror(control));
  }, true);

  document.addEventListener("reset", () => {
    queueMicrotask(() => syncInputMirrors(document));
  }, true);

  document.addEventListener("scroll", (event) => {
    const control = eventTextControl(event);
    if (control) syncInputMirror(control);
    scheduleInputMirrorLayout();
  }, { passive: true, capture: true });
  window.addEventListener("resize", scheduleInputMirrorLayout, { passive: true });

  document.addEventListener("keydown", (event) => {
    if (!veilActive() || activeElementIsEditable() || event.repeat) return;
    if (event.key !== resolved.effective.revealKey) return;
    holdingRevealKey = true;
    const selected = selectedBlock();
    revealFollowsPointer = !selected;
    peekElement(selected || pointerBlock());
  }, true);

  document.addEventListener("keyup", (event) => {
    if (event.key !== resolved?.effective?.revealKey) return;
    holdingRevealKey = false;
    revealFollowsPointer = false;
    peekElement(null);
  }, true);

  document.addEventListener("pointermove", (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    if (holdingRevealKey && revealFollowsPointer) {
      setRevealElement(event.target.closest?.(BLOCK_SELECTOR) || null);
    }
  }, { passive: true, capture: true });

  for (const eventName of ["pointerdown", "keydown", "scroll", "touchstart"]) {
    document.addEventListener(eventName, resetInactivity, { passive: true, capture: true });
  }

  document.addEventListener("dblclick", (event) => {
    if (!resolved?.effective?.learningHints || activeElementIsEditable()) return;
    const part = event.target.closest?.("[data-gv-overlay-part]");
    if (part) {
      part.classList.add("gv-learning-hint");
      setTimeout(() => part.classList.remove("gv-learning-hint"), 2500);
    } else if (resolved.effective.renderer === "unicode") {
      const block = event.target.closest?.(BLOCK_SELECTOR);
      if (block) {
        setRevealElement(block);
        setTimeout(() => setRevealElement(null), 2500);
      }
    }
  }, true);

  window.addEventListener("blur", () => {
    holdingRevealKey = false;
    revealFollowsPointer = false;
    peekElement(null);
    if (resolved?.effective?.autoVeilOnBlur) setAutomationReason("blur", true);
  });
  window.addEventListener("focus", () => {
    setAutomationReason("blur", false);
    resetInactivity();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      holdingRevealKey = false;
      revealFollowsPointer = false;
      peekElement(null);
      clearTimeout(inputMonitorTimer);
      inputMonitorTimer = null;
      cancelShadowAudit();
    } else {
      scheduleInputMonitor();
      scheduleShadowAudit(1000);
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "gv-apply-state") applyResolved(message.payload);
    else if (message?.type === "gv-peek-selection") {
      const selected = selectedBlock();
      if (selected) {
        peekElement(selected, Math.min(30_000, message.durationMs || 5000));
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "Select some page text first." });
      }
    }
    else if (message?.type === "gv-get-diagnostics") {
      sendResponse({
        ...diagnostics,
        degraded: [...diagnostics.degraded, ...googleDocsWarnings()],
        enabled: veilActive(),
        savedEnabled: resolved?.effective?.enabled || false,
        automationReasons: [...automationReasons],
        scope: resolved?.effective?.scope || "unknown",
        supported: resolved?.effective?.supported || false,
        urlIncluded: false
      });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[State.SETTINGS_KEY]) refreshState();
  });

  if (isGoogleDocsDocument) {
    window.addEventListener("message", (event) => {
      if (event.source !== window ||
          event.data?.channel !== GOOGLE_DOCS_STATUS_CHANNEL ||
          !event.data.status) {
        return;
      }
      googleDocsStatus = event.data.status;
      diagnostics.googleDocs = googleDocsStatus;
      updateIndicator();
    });
  }

  observe();
  refreshState();
  if (!documentParsed) {
    document.addEventListener("DOMContentLoaded", () => {
      documentParsed = true;
      syncDocumentPresentation();
    }, { once: true });
  }
})();
