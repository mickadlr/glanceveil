(() => {
  "use strict";

  const Core = globalThis.GreekVeilCore;
  const contextPrototype = globalThis.CanvasRenderingContext2D?.prototype;
  const isGoogleDocument =
    location.hostname === "docs.google.com" && location.pathname.startsWith("/document/");
  if (!Core || !contextPrototype || !isGoogleDocument ||
      globalThis.__kalimaGoogleDocsAdapterInstalled) {
    return;
  }

  const STATE_CHANNEL = "kalima-google-docs-state-v1";
  const STATUS_CHANNEL = "kalima-google-docs-status-v1";
  const PRESTATE_WAIT_MS = 750;
  const MAX_QUEUED_DRAWS = 2_000;
  const CONTEXT_STATE_PROPERTIES = [
    "direction", "fillStyle", "filter", "font", "fontKerning", "fontStretch",
    "fontVariantCaps", "globalAlpha", "globalCompositeOperation", "letterSpacing",
    "lineCap", "lineDashOffset", "lineJoin", "lineWidth", "miterLimit",
    "shadowBlur", "shadowColor", "shadowOffsetX", "shadowOffsetY", "strokeStyle",
    "textAlign", "textBaseline", "textRendering", "wordSpacing"
  ];
  const nativeFillText = contextPrototype.fillText;
  const nativeStrokeText = contextPrototype.strokeText;
  const nativeMeasureText = contextPrototype.measureText;
  const nativeSave = contextPrototype.save;
  const nativeRestore = contextPrototype.restore;
  const nativeGetTransform = contextPrototype.getTransform;
  const nativeSetTransform = contextPrototype.setTransform;
  const nativeGetLineDash = contextPrototype.getLineDash;
  const nativeSetLineDash = contextPrototype.setLineDash;
  const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
  const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);

  let state = {
    received: false,
    enabled: false,
    renderer: "unicode",
    pack: null,
    profileId: "",
    sensitiveMode: "off",
    sensitivePack: null,
    clearWordFraction: 0,
    sessionVariation: false,
    sessionSeed: 1,
    letterSpacing: 0
  };
  let stateSignature = "";
  let statusQueued = false;
  let pendingTimer = 0;
  let prestateTimedOut = false;
  const pendingDraws = [];
  const stats = {
    patched: true,
    detected: false,
    supported: true,
    targetDrawCalls: 0,
    transformedDrawCalls: 0,
    drawsBeforeState: 0,
    queuedDrawCalls: 0,
    replayedDrawCalls: 0,
    droppedQueuedDrawCalls: 0,
    queueTimedOut: false,
    reloadRequired: false
  };

  function isDocsCanvas(context) {
    const canvas = context?.canvas;
    return canvas instanceof HTMLCanvasElement &&
      canvas.classList.contains("kix-canvas-tile-content");
  }

  function hashText(value, seed = 2166136261) {
    let hash = seed | 0;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    }
    return hash >>> 0;
  }

  function validPack(candidate, expectedId) {
    if (!candidate || candidate.id !== expectedId) return null;
    return Core.validatePack(candidate).valid ? candidate : null;
  }

  function builtinPack(packId) {
    return Core.BUILTIN_PACKS.find((pack) => pack.id === packId) || null;
  }

  function resolvePack(candidate, packId) {
    return validPack(candidate, packId) || builtinPack(packId);
  }

  function statusSnapshot() {
    return Object.freeze({
      ...stats,
      renderer: state.renderer,
      packId: state.pack?.id || ""
    });
  }

  function postStatus() {
    if (statusQueued) return;
    statusQueued = true;
    queueMicrotask(() => {
      statusQueued = false;
      window.postMessage({
        channel: STATUS_CHANNEL,
        status: statusSnapshot()
      }, location.origin);
    });
  }

  function looksSensitive(text) {
    if (!text || state.sensitiveMode === "off") return false;
    return /(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\p{Sc}\s?\d|\b(?:\d[ -]?){8,}\d\b)/u
      .test(text);
  }

  function transformText(source, x, y) {
    let pack = state.pack;
    let profileId = state.profileId;
    if (!pack) return source;

    if (looksSensitive(source)) {
      if (state.sensitiveMode === "pack" &&
          state.sensitivePack?.renderers?.includes(state.renderer)) {
        pack = state.sensitivePack;
        profileId = pack.profiles.dense ? "dense" : pack.defaultProfile;
      } else if (pack.profiles.dense) {
        profileId = "dense";
      }
    }

    const positionSeed = hashText(`${source}\u0000${x}\u0000${y}`, state.sessionSeed);
    const rendered = Core.transform(source, pack, profileId, {
      clearWordFraction: state.clearWordFraction,
      sourceOffset: positionSeed,
      variationSeed: state.sessionVariation ? positionSeed : 0,
      wordOffset: 0,
      wordSeed: positionSeed
    });
    if (pack.script === "Arabic" || pack.script === "Hebrew") {
      return `\u202D${rendered}\u202C`;
    }
    return rendered;
  }

  function paintTargetText(nativeMethod, context, args) {
    if (!state.enabled || !stats.supported) {
      postStatus();
      return nativeMethod.apply(context, args);
    }

    const source = String(args[0] ?? "");
    if (!/[A-Za-z]/.test(source)) return nativeMethod.apply(context, args);
    const rendered = transformText(source, args[1], args[2]);
    if (rendered === source) return nativeMethod.apply(context, args);

    const sourceWidth = nativeMeasureText.call(context, source).width;
    const renderedWidth = nativeMeasureText.call(context, rendered).width;
    const suppliedMaxWidth = Number(args[3]);
    const widthLimit = Number.isFinite(suppliedMaxWidth) && suppliedMaxWidth > 0
      ? Math.min(suppliedMaxWidth, sourceWidth || suppliedMaxWidth)
      : sourceWidth;
    const renderedArgs = [rendered, args[1], args[2]];
    if (Number.isFinite(widthLimit) && widthLimit > 0 && renderedWidth > widthLimit) {
      renderedArgs.push(widthLimit);
    } else if (args.length > 3) {
      renderedArgs.push(args[3]);
    }

    nativeSave.call(context);
    try {
      context.direction = "ltr";
      if ("letterSpacing" in context && state.letterSpacing) {
        context.letterSpacing = `${state.letterSpacing}px`;
      }
      stats.transformedDrawCalls += 1;
      postStatus();
      return nativeMethod.apply(context, renderedArgs);
    } finally {
      nativeRestore.call(context);
    }
  }

  function captureContextState(context) {
    const properties = {};
    for (const property of CONTEXT_STATE_PROPERTIES) {
      try {
        if (property in context) properties[property] = context[property];
      } catch {
        // A partially implemented optional canvas property can be ignored.
      }
    }
    let transform = null;
    let lineDash = null;
    try {
      if (nativeGetTransform) transform = nativeGetTransform.call(context);
      if (nativeGetLineDash) lineDash = nativeGetLineDash.call(context);
    } catch {
      // The core font, color, and position state is still enough to replay.
    }
    return {
      properties,
      transform,
      lineDash,
      canvasWidth: context.canvas.width,
      canvasHeight: context.canvas.height
    };
  }

  function applyContextState(context, snapshot) {
    if (snapshot.transform && nativeSetTransform) {
      nativeSetTransform.call(context, snapshot.transform);
    }
    if (snapshot.lineDash && nativeSetLineDash) {
      nativeSetLineDash.call(context, snapshot.lineDash);
    }
    for (const [property, value] of Object.entries(snapshot.properties)) {
      try {
        context[property] = value;
      } catch {
        // Ignore optional properties that became read-only between draws.
      }
    }
  }

  function flushPendingDraws(useSourceText) {
    if (pendingTimer) {
      nativeClearTimeout(pendingTimer);
      pendingTimer = 0;
    }
    const queued = pendingDraws.splice(0);
    for (const entry of queued) {
      const { context, nativeMethod, args, snapshot } = entry;
      if (context.canvas.width !== snapshot.canvasWidth ||
          context.canvas.height !== snapshot.canvasHeight) {
        stats.droppedQueuedDrawCalls += 1;
        stats.reloadRequired = true;
        continue;
      }
      nativeSave.call(context);
      try {
        applyContextState(context, snapshot);
        if (useSourceText) nativeMethod.apply(context, args);
        else paintTargetText(nativeMethod, context, args);
        stats.replayedDrawCalls += 1;
      } finally {
        nativeRestore.call(context);
      }
    }
    postStatus();
  }

  function timeOutPendingDraws() {
    if (state.received || prestateTimedOut) return;
    prestateTimedOut = true;
    stats.queueTimedOut = true;
    stats.reloadRequired = true;
    flushPendingDraws(true);
  }

  function queuePendingDraw(nativeMethod, context, args) {
    pendingDraws.push({
      nativeMethod,
      context,
      args: [...args],
      snapshot: captureContextState(context)
    });
    stats.queuedDrawCalls += 1;
    if (!pendingTimer) {
      pendingTimer = nativeSetTimeout(timeOutPendingDraws, PRESTATE_WAIT_MS);
    }
    if (pendingDraws.length >= MAX_QUEUED_DRAWS) timeOutPendingDraws();
    postStatus();
  }

  function drawText(nativeMethod, context, args) {
    if (!isDocsCanvas(context)) return nativeMethod.apply(context, args);

    stats.detected = true;
    stats.targetDrawCalls += 1;
    if (!state.received) {
      stats.drawsBeforeState += 1;
      if (prestateTimedOut) return nativeMethod.apply(context, args);
      queuePendingDraw(nativeMethod, context, args);
      return undefined;
    }
    return paintTargetText(nativeMethod, context, args);
  }

  function installTextMethod(name, nativeMethod) {
    const descriptor = Object.getOwnPropertyDescriptor(contextPrototype, name);
    Object.defineProperty(contextPrototype, name, {
      ...descriptor,
      value: function kalimaGoogleDocsTextDraw(...args) {
        return drawText(nativeMethod, this, args);
      }
    });
  }

  installTextMethod("fillText", nativeFillText);
  installTextMethod("strokeText", nativeStrokeText);

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.channel !== STATE_CHANNEL) return;
    const incoming = event.data.state;
    if (!incoming || typeof incoming !== "object") return;

    const pack = resolvePack(incoming.pack, incoming.packId);
    const sensitivePack = resolvePack(incoming.sensitivePack, incoming.sensitivePackId);
    const profileId = pack?.profiles?.[incoming.profileId]
      ? incoming.profileId
      : pack?.defaultProfile || "";
    const nextSignature = JSON.stringify([
      Boolean(incoming.enabled),
      incoming.renderer,
      pack,
      profileId,
      incoming.sensitiveMode,
      sensitivePack,
      incoming.clearWordFraction,
      Boolean(incoming.sessionVariation),
      Number(incoming.sessionSeed) >>> 0 || 1,
      incoming.letterSpacing
    ]);

    const nextState = {
      received: true,
      enabled: Boolean(incoming.enabled),
      renderer: incoming.renderer,
      pack,
      profileId,
      sensitiveMode: ["off", "dense", "pack"].includes(incoming.sensitiveMode)
        ? incoming.sensitiveMode
        : "off",
      sensitivePack,
      clearWordFraction: Number.isFinite(incoming.clearWordFraction)
        ? Math.min(0.5, Math.max(0, incoming.clearWordFraction))
        : 0,
      sessionVariation: Boolean(incoming.sessionVariation),
      sessionSeed: Number(incoming.sessionSeed) >>> 0 || 1,
      letterSpacing: Number.isFinite(incoming.letterSpacing)
        ? Math.min(3, Math.max(-1, incoming.letterSpacing))
        : 0
    };
    const nextSupported = Boolean(pack) && incoming.renderer !== "strokes";

    if (!state.received && prestateTimedOut) {
      state = { ...nextState, enabled: false };
      stateSignature = nextSignature;
      stats.supported = nextSupported;
      stats.reloadRequired = nextState.enabled;
      postStatus();
      return;
    }
    if (state.received && stateSignature !== nextSignature &&
        stats.targetDrawCalls > 0) {
      stats.reloadRequired = true;
      postStatus();
      return;
    }
    if (stats.reloadRequired && stats.targetDrawCalls > 0) {
      postStatus();
      return;
    }

    state = nextState;
    stateSignature = nextSignature;
    stats.supported = nextSupported;
    flushPendingDraws(false);
    postStatus();
  });

  Object.defineProperty(globalThis, "__kalimaGoogleDocsAdapterInstalled", {
    value: true,
    configurable: false
  });
  Object.defineProperty(globalThis, "__kalimaGoogleDocsAdapter", {
    get: statusSnapshot,
    configurable: false
  });
})();
