import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import * as Core from "../../browser-extension/shared/core";
import type { VeilPack } from "../../browser-extension/shared/core";

const SUPPORT_URL = "https://ko-fi.com/mickadlr";

export type VeilRenderer = "overlay" | "unicode" | "strokes";

export interface ObsidianVeilSettings {
  enabled: boolean;
  veilEditor: boolean;
  veilReadingView: boolean;
  packId: string;
  profileId: string;
  renderer: VeilRenderer;
  clearWordFraction: number;
  sessionVariation: boolean;
  glyphScale: number;
  letterSpacing: number;
  showStatusBar: boolean;
}

export const DEFAULT_SETTINGS: Readonly<ObsidianVeilSettings> = Object.freeze({
  enabled: true,
  veilEditor: true,
  veilReadingView: true,
  packId: "greek",
  profileId: "dense",
  renderer: "unicode",
  clearWordFraction: 0,
  sessionVariation: false,
  glyphScale: 1,
  letterSpacing: 0,
  showStatusBar: true
});

export function sanitizeSettings(input: unknown): ObsidianVeilSettings {
  const raw = input && typeof input === "object"
    ? input as Partial<ObsidianVeilSettings>
    : {};
  const pack = Core.getPack(typeof raw.packId === "string" ? raw.packId : DEFAULT_SETTINGS.packId);
  const profileId = typeof raw.profileId === "string" && pack.profiles[raw.profileId]
    ? raw.profileId
    : pack.defaultProfile;
  return {
    enabled: raw.enabled !== false,
    veilEditor: raw.veilEditor !== false,
    veilReadingView: raw.veilReadingView !== false,
    packId: pack.id,
    profileId,
    renderer: Core.resolveRenderer(pack, raw.renderer || DEFAULT_SETTINGS.renderer),
    clearWordFraction: Number.isFinite(raw.clearWordFraction)
      ? Math.min(0.5, Math.max(0, Number(raw.clearWordFraction)))
      : DEFAULT_SETTINGS.clearWordFraction,
    sessionVariation: Boolean(raw.sessionVariation),
    glyphScale: Number.isFinite(raw.glyphScale)
      ? Math.min(1.2, Math.max(0.8, Number(raw.glyphScale)))
      : DEFAULT_SETTINGS.glyphScale,
    letterSpacing: Number.isFinite(raw.letterSpacing)
      ? Math.min(3, Math.max(-1, Number(raw.letterSpacing)))
      : DEFAULT_SETTINGS.letterSpacing,
    showStatusBar: raw.showStatusBar !== false
  };
}

export interface VeilSettingsHost extends Plugin {
  settings: ObsidianVeilSettings;
  updateSettings(patch: Partial<ObsidianVeilSettings>): Promise<void>;
}

function addPackOptions(dropdown: { addOption(value: string, display: string): unknown }): void {
  for (const pack of Core.BUILTIN_PACKS) {
    const suffix = pack.maturity === "production" ? "" : ` · ${pack.maturity}`;
    dropdown.addOption(pack.id, `${pack.name}${suffix}`);
  }
}

function addProfileOptions(
  dropdown: { addOption(value: string, display: string): unknown },
  pack: VeilPack
): void {
  for (const [id, profile] of Object.entries(pack.profiles)) {
    dropdown.addOption(id, profile.name || id);
  }
}

function addRendererOptions(
  dropdown: { addOption(value: string, display: string): unknown },
  pack: VeilPack
): void {
  const labels: Record<string, string> = {
    overlay: "Source-preserving overlay",
    unicode: "Fast Unicode decorations",
    strokes: "Source-preserving connected strokes"
  };
  for (const renderer of pack.renderers) dropdown.addOption(renderer, labels[renderer] || renderer);
}

export class GlanceVeilSettingTab extends PluginSettingTab {
  private readonly host: VeilSettingsHost;

  constructor(app: App, host: VeilSettingsHost) {
    super(app, host);
    this.host = host;
  }

  display(): void {
    const { containerEl } = this;
    const settings = this.host.settings;
    const pack = Core.getPack(settings.packId);
    containerEl.empty();

    new Setting(containerEl)
      .setName("Enable veil")
      .setDesc("Change only how note text is displayed. Markdown files remain untouched.")
      .addToggle((toggle) => toggle
        .setValue(settings.enabled)
        .onChange((value) => this.host.updateSettings({ enabled: value })));

    new Setting(containerEl)
      .setName("Editor")
      .setDesc("Veil Markdown text in Live Preview and source mode.")
      .addToggle((toggle) => toggle
        .setValue(settings.veilEditor)
        .onChange((value) => this.host.updateSettings({ veilEditor: value })));

    new Setting(containerEl)
      .setName("Reading view")
      .setDesc("Veil rendered Markdown while leaving the vault file unchanged.")
      .addToggle((toggle) => toggle
        .setValue(settings.veilReadingView)
        .onChange((value) => this.host.updateSettings({ veilReadingView: value })));

    new Setting(containerEl)
      .setName("Script")
      .addDropdown((dropdown) => {
        addPackOptions(dropdown);
        dropdown
          .setValue(pack.id)
          .onChange(async (packId) => {
            const nextPack = Core.getPack(packId);
            await this.host.updateSettings({
              packId: nextPack.id,
              profileId: nextPack.defaultProfile,
              renderer: nextPack.defaultRenderer
            });
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Profile")
      .addDropdown((dropdown) => {
        addProfileOptions(dropdown, pack);
        dropdown
          .setValue(settings.profileId)
          .onChange((profileId) => this.host.updateSettings({ profileId }));
      });

    new Setting(containerEl)
      .setName("Rendering")
      .addDropdown((dropdown) => {
        addRendererOptions(dropdown, pack);
        dropdown
          .setValue(settings.renderer)
          .onChange((renderer) =>
            this.host.updateSettings({ renderer: renderer as VeilRenderer }));
      });

    const clearWords = new Setting(containerEl)
      .setName("Keep some words visible")
      .setDesc(`${Math.round(settings.clearWordFraction * 100)}% of eligible whole words`);
    clearWords.addSlider((slider) => slider
      .setLimits(0, 0.5, 0.05)
      .setValue(settings.clearWordFraction)
      .setDynamicTooltip()
      .onChange(async (value) => {
        await this.host.updateSettings({ clearWordFraction: value });
        clearWords.setDesc(`${Math.round(value * 100)}% of eligible whole words`);
      }));

    new Setting(containerEl)
      .setName("Session variation")
      .setDesc("Use declared alternate glyphs consistently for the current session.")
      .addToggle((toggle) => toggle
        .setValue(settings.sessionVariation)
        .onChange((value) => this.host.updateSettings({ sessionVariation: value })));

    new Setting(containerEl)
      .setName("Glyph scale")
      .setDesc(`${Math.round(settings.glyphScale * 100)}%`)
      .addSlider((slider) => slider
        .setLimits(0.8, 1.2, 0.05)
        .setValue(settings.glyphScale)
        .onChange((value) => this.host.updateSettings({ glyphScale: value })));

    new Setting(containerEl)
      .setName("Letter spacing")
      .setDesc(`${settings.letterSpacing.toFixed(1)} px`)
      .addSlider((slider) => slider
        .setLimits(-1, 3, 0.25)
        .setValue(settings.letterSpacing)
        .onChange((value) => this.host.updateSettings({ letterSpacing: value })));

    new Setting(containerEl)
      .setName("Status bar")
      .setDesc("Show the active script and provide a click-to-toggle control.")
      .addToggle((toggle) => toggle
        .setValue(settings.showStatusBar)
        .onChange((value) => this.host.updateSettings({ showStatusBar: value })));

    const support = new Setting(containerEl)
      .setName("Support GlanceVeil")
      .setDesc("Optional. Tips do not unlock features or grant commercial-use rights.");
    const supportLink = support.controlEl.createEl("a", {
      text: "Open Ko-fi",
      href: SUPPORT_URL
    });
    supportLink.setAttr("target", "_blank");
    supportLink.setAttr("rel", "noopener noreferrer");
  }
}
