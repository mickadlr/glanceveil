import type { Extension } from "@codemirror/state";
import {
  type MarkdownPostProcessorContext,
  Notice,
  Platform,
  Plugin
} from "obsidian";
import * as Core from "../../browser-extension/shared/core";
import { createEditorExtension } from "./editor-renderer";
import {
  ReadingVeilChild,
  type ReadingVeilHost
} from "./reading-renderer";
import {
  DEFAULT_SETTINGS,
  KalimaSettingTab,
  type ObsidianVeilSettings,
  sanitizeSettings,
  type VeilSettingsHost
} from "./settings";

export default class KalimaPlugin extends Plugin
  implements VeilSettingsHost, ReadingVeilHost {
  settings: ObsidianVeilSettings = { ...DEFAULT_SETTINGS };
  readonly sessionSeed = Math.floor(Math.random() * 0x7fffffff);

  private readonly editorExtensions: Extension[] = [];
  private readonly readingChildren = new Set<ReadingVeilChild>();
  private ribbonEl: HTMLElement | null = null;
  private statusBarEl: HTMLElement | null = null;
  private refreshTimer: number | null = null;
  private saveQueue: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    this.settings = sanitizeSettings(await this.loadData());

    this.rebuildEditorExtensions(false);
    this.registerEditorExtension(this.editorExtensions);
    this.registerMarkdownPostProcessor((
      element: HTMLElement,
      context: MarkdownPostProcessorContext
    ) => {
      const lineStart = context.getSectionInfo(element)?.lineStart ?? 0;
      context.addChild(new ReadingVeilChild(
        element,
        this,
        `${context.sourcePath}:${lineStart}`
      ));
    });

    this.addCommand({
      id: "toggle-veil",
      name: "Toggle veil",
      callback: () => {
        void this.updateSettings({ enabled: !this.settings.enabled });
      }
    });

    this.addCommand({
      id: "cycle-script",
      name: "Cycle script",
      callback: () => {
        const packs = Core.BUILTIN_PACKS;
        const index = packs.findIndex((pack) => pack.id === this.settings.packId);
        const next = packs[(index + 1 + packs.length) % packs.length] || packs[0];
        void this.updateSettings({
          packId: next.id,
          profileId: next.defaultProfile,
          renderer: next.defaultRenderer
        }).then(() => new Notice(`Kalima: ${next.name}`));
      }
    });

    this.addCommand({
      id: "peek-selected-text",
      name: "Peek selected text",
      checkCallback: (checking) => {
        const selection = window.getSelection();
        const available = Boolean(selection && !selection.isCollapsed);
        if (checking) return available;
        if (!available) return false;
        const revealed = this.peekReadingSelection();
        if (!revealed) {
          new Notice("The editor reveals its selected text automatically.");
        }
        return true;
      }
    });

    this.addSettingTab(new KalimaSettingTab(this.app, this));

    this.ribbonEl = this.addRibbonIcon("eye-off", "Toggle Kalima veil", () => {
      void this.updateSettings({ enabled: !this.settings.enabled });
    });
    this.ribbonEl.addClass("gv-obsidian-ribbon");

    if (!Platform.isMobile) {
      this.statusBarEl = this.addStatusBarItem();
      this.statusBarEl.addClass("gv-obsidian-status");
      this.registerDomEvent(this.statusBarEl, "click", () => {
        void this.updateSettings({ enabled: !this.settings.enabled });
      });
    }

    this.register(() => {
      if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    });
    this.updateControls();
  }

  async updateSettings(patch: Partial<ObsidianVeilSettings>): Promise<void> {
    this.settings = sanitizeSettings({ ...this.settings, ...patch });
    const snapshot = { ...this.settings };
    this.saveQueue = this.saveQueue
      .catch(() => undefined)
      .then(() => this.saveData(snapshot));
    await this.saveQueue;
    this.scheduleVisualRefresh();
    this.updateControls();
  }

  attachReadingChild(child: ReadingVeilChild): void {
    this.readingChildren.add(child);
  }

  detachReadingChild(child: ReadingVeilChild): void {
    this.readingChildren.delete(child);
  }

  private rebuildEditorExtensions(updateExistingEditors: boolean): void {
    this.editorExtensions.length = 0;
    if (this.settings.enabled && this.settings.veilEditor) {
      this.editorExtensions.push(createEditorExtension(this.settings, this.sessionSeed));
    }
    if (updateExistingEditors) this.app.workspace.updateOptions();
  }

  private peekReadingSelection(): number {
    let count = 0;
    for (const child of this.readingChildren) count += child.peekSelection();
    return count;
  }

  private scheduleVisualRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.rebuildEditorExtensions(true);
      for (const child of this.readingChildren) child.render();
    }, 40);
  }

  private updateControls(): void {
    const action = this.settings.enabled ? "Disable Kalima" : "Enable Kalima";
    if (this.ribbonEl) {
      this.ribbonEl.toggleClass("gv-obsidian-ribbon-off", !this.settings.enabled);
      this.ribbonEl.setAttribute("aria-label", action);
      this.ribbonEl.setAttribute("aria-pressed", String(this.settings.enabled));
    }

    if (!this.statusBarEl) return;
    const pack = Core.getPack(this.settings.packId);
    this.statusBarEl.toggleClass("gv-obsidian-status-hidden", !this.settings.showStatusBar);
    this.statusBarEl.toggleClass("gv-obsidian-status-off", !this.settings.enabled);
    this.statusBarEl.setText(this.settings.enabled ? `Kaλima · ${pack.name}` : "Kaλima · off");
    this.statusBarEl.setAttribute("aria-label", action);
  }
}
