import { MarkdownRenderChild } from "obsidian";
import * as Core from "../../browser-extension/shared/core";
import * as Gregg from "../../browser-extension/shared/gregg";
import type { GreggOutline } from "../../browser-extension/shared/gregg";
import type { ObsidianVeilSettings } from "./settings";

const SKIP_SELECTOR = [
  "code", "pre", "kbd", "samp", "script", "style", "textarea", "input",
  "select", "option", "svg", "math", "canvas", "[contenteditable='true']",
  ".frontmatter", ".metadata-container", "[data-gv-obsidian-word]"
].join(",");

let readingOwnerSequence = 0;

export interface ReadingVeilHost {
  settings: ObsidianVeilSettings;
  sessionSeed: number;
  attachReadingChild(child: ReadingVeilChild): void;
  detachReadingChild(child: ReadingVeilChild): void;
}

function hashText(text: string, seed = 2166136261): number {
  let hash = seed | 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash | 0;
}

function appendGreggSvg(host: HTMLElement, outline: GreggOutline, word: string): void {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("viewBox", outline.viewBox);
  svg.setAttribute("width", `${Math.max(1.2, word.length * 0.56)}em`);
  svg.setAttribute("height", "1em");
  for (const pathData of outline.paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData.d);
    path.setAttribute("stroke-width", String(pathData.width));
    svg.append(path);
  }
  host.append(svg);
}

function eligibleTextNode(node: Text, root: HTMLElement): boolean {
  const parent = node.parentElement;
  return Boolean(
    parent &&
    root.contains(parent) &&
    /[A-Za-z]/.test(node.nodeValue || "") &&
    !parent.closest(SKIP_SELECTOR)
  );
}

export class ReadingVeilChild extends MarkdownRenderChild {
  private readonly host: ReadingVeilHost;
  private readonly ownerId = String(++readingOwnerSequence);
  private readonly sourcePath: string;
  private peekTimer: number | null = null;

  constructor(containerEl: HTMLElement, host: ReadingVeilHost, sourcePath: string) {
    super(containerEl);
    this.host = host;
    this.sourcePath = sourcePath;
  }

  onload(): void {
    this.host.attachReadingChild(this);
    this.render();
  }

  onunload(): void {
    if (this.peekTimer !== null) window.clearTimeout(this.peekTimer);
    this.restore();
    this.host.detachReadingChild(this);
  }

  render(): void {
    this.restore();
    const settings = this.host.settings;
    if (!settings.enabled || !settings.veilReadingView) return;

    this.containerEl.style.setProperty("--gv-obsidian-scale", String(settings.glyphScale));
    this.containerEl.style.setProperty("--gv-obsidian-spacing", `${settings.letterSpacing}px`);
    const pack = Core.getPack(settings.packId);
    const renderer = Core.resolveRenderer(pack, settings.renderer);
    const seed = hashText(this.sourcePath, this.host.sessionSeed);
    const walker = document.createTreeWalker(this.containerEl, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node;
    while ((node = walker.nextNode())) {
      if (eligibleTextNode(node as Text, this.containerEl)) nodes.push(node as Text);
    }

    let wordOffset = 0;
    let characterOffset = 0;
    for (const textNode of nodes) {
      const text = textNode.nodeValue || "";
      const plan = Core.planVeil(text, pack, settings.profileId, {
        clearWordFraction: settings.clearWordFraction,
        sourceOffset: characterOffset,
        variationSeed: settings.sessionVariation ? seed : 0,
        wordOffset,
        wordSeed: seed
      });
      wordOffset += Core.countClearWordCandidates(text);
      characterOffset += text.length;
      if (!plan.some((span) => !span.clear)) continue;

      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const span of plan) {
        fragment.append(text.slice(cursor, span.from));
        if (span.clear) {
          fragment.append(span.original);
        } else {
          fragment.append(this.createWord(span.original, span.rendered, renderer));
        }
        cursor = span.to;
      }
      fragment.append(text.slice(cursor));
      textNode.replaceWith(fragment);
    }
  }

  peekSelection(durationMs = 5000): number {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return 0;
    const selected: HTMLElement[] = [];
    const words = this.containerEl.querySelectorAll<HTMLElement>(
      `[data-gv-reading-owner="${this.ownerId}"]`
    );
    for (const word of words) {
      for (let index = 0; index < selection.rangeCount; index += 1) {
        const range = selection.getRangeAt(index);
        try {
          if (!range.intersectsNode(word)) continue;
          selected.push(word);
          break;
        } catch {
          // A detached selection range can disappear while a preview rerenders.
        }
      }
    }
    if (!selected.length) return 0;
    for (const word of selected) word.classList.add("gv-obsidian-peek");
    if (this.peekTimer !== null) window.clearTimeout(this.peekTimer);
    this.peekTimer = window.setTimeout(() => {
      for (const word of selected) word.classList.remove("gv-obsidian-peek");
      this.peekTimer = null;
    }, Math.min(15000, Math.max(250, durationMs)));
    return selected.length;
  }

  private createWord(
    original: string,
    rendered: string,
    renderer: "overlay" | "unicode" | "strokes"
  ): HTMLElement {
    const word = document.createElement("span");
    word.className = `gv-obsidian-reading-word gv-obsidian-${renderer}`;
    word.dataset.gvReadingOwner = this.ownerId;
    word.dataset.gvOriginal = original;

    if (renderer === "unicode") {
      word.textContent = rendered;
      return word;
    }

    word.textContent = original;
    if (renderer === "overlay") {
      word.dataset.gvRendered = rendered;
      return word;
    }

    const outline = Gregg.outlineWord(original);
    if (outline) appendGreggSvg(word, outline, original);
    return word;
  }

  private restore(): void {
    if (this.peekTimer !== null) {
      window.clearTimeout(this.peekTimer);
      this.peekTimer = null;
    }
    const parents = new Set<Node>();
    for (const word of this.containerEl.querySelectorAll<HTMLElement>(
      `[data-gv-reading-owner="${this.ownerId}"]`
    )) {
      const parent = word.parentNode;
      if (parent) parents.add(parent);
      word.replaceWith(document.createTextNode(word.dataset.gvOriginal || word.textContent || ""));
    }
    for (const parent of parents) parent.normalize();
    this.containerEl.style.removeProperty("--gv-obsidian-scale");
    this.containerEl.style.removeProperty("--gv-obsidian-spacing");
  }
}
