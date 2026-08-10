import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from "@codemirror/view";
import * as Core from "../../browser-extension/shared/core";
import * as Gregg from "../../browser-extension/shared/gregg";
import type { VeilSpan } from "../../browser-extension/shared/core";
import type { ObsidianVeilSettings } from "./settings";

interface SourceRange {
  from: number;
  to: number;
}

const EXCLUDED_SYNTAX = /(?:Code|Frontmatter|YAML|HTML|Comment|URL|LinkMark|CodeMark|EmbedMark)/i;

function overlaps(left: SourceRange, right: SourceRange): boolean {
  return left.from < right.to && left.to > right.from;
}

function currentSelectionReveals(view: EditorView, range: SourceRange): boolean {
  return view.state.selection.ranges.some((selection) => {
    if (selection.empty) return range.from < selection.head && selection.head <= range.to;
    return overlaps(range, { from: selection.from, to: selection.to });
  });
}

function syntaxExclusions(view: EditorView, from: number, to: number): SourceRange[] {
  const exclusions: SourceRange[] = [];
  syntaxTree(view.state).iterate({
    from,
    to,
    enter(node) {
      if (!EXCLUDED_SYNTAX.test(node.type.name)) return;
      exclusions.push({ from: node.from, to: node.to });
      return false;
    }
  });

  if (view.state.doc.length >= 3 && view.state.doc.sliceString(0, 3) === "---") {
    for (let lineNumber = 2; lineNumber <= view.state.doc.lines; lineNumber += 1) {
      const line = view.state.doc.line(lineNumber);
      if (line.text.trim() !== "---") continue;
      exclusions.push({ from: 0, to: line.to });
      break;
    }
  }
  return exclusions;
}

function textExclusions(text: string, sourceOffset: number): SourceRange[] {
  const exclusions: SourceRange[] = [];
  const pattern = /`[^`\n]*`|(?:https?:\/\/|www\.)[^\s)\]}]+|\]\([^)\n]+\)/giu;
  let match;
  while ((match = pattern.exec(text))) {
    exclusions.push({
      from: sourceOffset + match.index,
      to: sourceOffset + match.index + match[0].length
    });
  }
  return exclusions;
}

class UnicodeWidget extends WidgetType {
  constructor(private readonly rendered: string) {
    super();
  }

  eq(other: UnicodeWidget): boolean {
    return other.rendered === this.rendered;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "gv-obsidian-cm-unicode";
    span.textContent = this.rendered;
    return span;
  }
}

class GreggWidget extends WidgetType {
  constructor(private readonly word: string) {
    super();
  }

  eq(other: GreggWidget): boolean {
    return other.word === this.word;
  }

  toDOM(): HTMLElement {
    const host = document.createElement("span");
    host.className = "gv-obsidian-cm-stroke";
    host.setAttribute("aria-label", this.word);
    const outline = Gregg.outlineWord(this.word);
    if (!outline) {
      host.textContent = this.word;
      return host;
    }

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("viewBox", outline.viewBox);
    svg.setAttribute("width", `${Math.max(1.2, this.word.length * 0.56)}em`);
    svg.setAttribute("height", "1em");
    for (const pathData of outline.paths) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData.d);
      path.setAttribute("stroke-width", String(pathData.width));
      svg.append(path);
    }
    host.append(svg);
    return host;
  }
}

function decorationFor(span: VeilSpan, settings: ObsidianVeilSettings) {
  if (settings.renderer === "unicode") {
    return Decoration.replace({ widget: new UnicodeWidget(span.rendered) });
  }
  if (settings.renderer === "strokes") {
    return Decoration.replace({ widget: new GreggWidget(span.original) });
  }
  return Decoration.mark({
    class: "gv-obsidian-cm-overlay",
    attributes: {
      "data-gv-rendered": span.rendered
    }
  });
}

function buildDecorations(
  view: EditorView,
  settings: ObsidianVeilSettings,
  sessionSeed: number
): DecorationSet {
  if (!settings.enabled || !settings.veilEditor) return Decoration.none;
  const pack = Core.getPack(settings.packId);
  const builder = new RangeSetBuilder<Decoration>();

  for (const visible of view.visibleRanges) {
    const text = view.state.doc.sliceString(visible.from, visible.to);
    const exclusions = [
      ...syntaxExclusions(view, visible.from, visible.to),
      ...textExclusions(text, visible.from)
    ];
    const wordOffset = settings.clearWordFraction > 0
      ? Core.countClearWordCandidates(view.state.doc.sliceString(0, visible.from))
      : 0;
    const plan = Core.planVeil(text, pack, settings.profileId, {
      clearWordFraction: settings.clearWordFraction,
      sourceOffset: visible.from,
      variationSeed: settings.sessionVariation ? sessionSeed : 0,
      wordOffset,
      wordSeed: sessionSeed
    });

    for (const span of plan) {
      if (span.clear) continue;
      const range = {
        from: visible.from + span.from,
        to: visible.from + span.to
      };
      if (currentSelectionReveals(view, range)) continue;
      if (exclusions.some((excluded) => overlaps(range, excluded))) continue;
      builder.add(range.from, range.to, decorationFor(span, settings));
    }
  }
  return builder.finish();
}

export function createEditorExtension(
  settings: ObsidianVeilSettings,
  sessionSeed: number
): Extension {
  class KalimaEditorPlugin implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view, settings, sessionSeed);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view, settings, sessionSeed);
      }
    }
  }

  return [
    ViewPlugin.fromClass(KalimaEditorPlugin, {
      decorations: (plugin) => plugin.decorations
    }),
    EditorView.theme({
      "&": {
        "--gv-obsidian-scale": String(settings.glyphScale),
        "--gv-obsidian-spacing": `${settings.letterSpacing}px`
      }
    })
  ];
}
