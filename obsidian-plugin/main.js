"use strict";
/*
 * Basa Sync — плагин Obsidian для двусторонней синхронизации Базы знаний Basa.
 * Установка: положите папку basa-sync в <хранилище>/.obsidian/plugins/ и включите плагин.
 * Настройки: URL приложения Basa + токен синхронизации (Настройки → База знаний · Obsidian).
 */
const { Plugin, PluginSettingTab, Setting, Notice, requestUrl, normalizePath } = require("obsidian");

const DEFAULTS = { baseUrl: "https://basefinance.pro", token: "", folder: "Basa" };

function safeName(title) {
  return String(title || "Без названия").replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Без названия";
}

// Мини-frontmatter (только нужные поля).
function buildFile(item) {
  const fm = ["---", `basa_id: ${item.id}`, `basa_updated_at: ${item.updated_at || ""}`, `title: ${JSON.stringify(item.title || "")}`, "---", ""].join("\n");
  return fm + (item.markdown || "");
}
function parseFile(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  let body = text;
  if (m) {
    body = text.slice(m[0].length);
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) {
        const k = line.slice(0, i).trim();
        let v = line.slice(i + 1).trim();
        if (v.startsWith('"')) { try { v = JSON.parse(v); } catch {} }
        meta[k] = v;
      }
    }
  }
  return { meta, body };
}

class BasaSyncPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.addSettingTab(new BasaSettingTab(this.app, this));
    this.addCommand({ id: "basa-pull", name: "Basa: скачать статьи (Pull)", callback: () => this.pull() });
    this.addCommand({ id: "basa-push", name: "Basa: отправить изменения (Push)", callback: () => this.push() });
    this.addCommand({ id: "basa-sync", name: "Basa: синхронизировать (Push + Pull)", callback: () => this.sync() });
  }

  api(path, method, body) {
    return requestUrl({
      url: this.settings.baseUrl.replace(/\/$/, "") + path,
      method: method || "GET",
      headers: { Authorization: "Bearer " + this.settings.token, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      throw: false,
    });
  }

  async ensureFolder() {
    const f = normalizePath(this.settings.folder);
    if (!this.app.vault.getAbstractFileByPath(f)) await this.app.vault.createFolder(f).catch(() => {});
    return f;
  }

  async pull() {
    if (!this.settings.token) return new Notice("Basa: укажите токен в настройках");
    const res = await this.api("/api/obsidian/pull");
    if (res.status !== 200) return new Notice("Basa Pull: ошибка " + res.status);
    const folder = await this.ensureFolder();
    const items = (res.json && res.json.items) || [];
    let n = 0;
    for (const it of items) {
      const path = normalizePath(`${folder}/${safeName(it.title)}.md`);
      const existing = this.app.vault.getAbstractFileByPath(path);
      const content = buildFile(it);
      if (existing) await this.app.vault.modify(existing, content);
      else await this.app.vault.create(path, content);
      n++;
    }
    new Notice(`Basa Pull: получено ${n} статей`);
  }

  async push() {
    if (!this.settings.token) return new Notice("Basa: укажите токен в настройках");
    const folder = normalizePath(this.settings.folder);
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder + "/") && !f.path.endsWith(".conflict.md"));
    const items = [];
    const byPath = {};
    for (const f of files) {
      const { meta, body } = parseFile(await this.app.vault.read(f));
      const item = { id: meta.basa_id || undefined, title: meta.title || f.basename, markdown: body, base_updated_at: meta.basa_updated_at || undefined };
      items.push(item);
      byPath[items.length - 1] = f;
    }
    if (!items.length) return new Notice("Basa Push: нет файлов в папке " + folder);
    const res = await this.api("/api/obsidian/push", "POST", { items });
    if (res.status !== 200) return new Notice("Basa Push: ошибка " + res.status);
    const results = (res.json && res.json.results) || [];
    let conflicts = 0;
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "conflict") {
        conflicts++;
        const f = byPath[i];
        if (f) await this.app.vault.create(normalizePath(f.path.replace(/\.md$/, "") + ".conflict.md"), await this.app.vault.read(f)).catch(() => {});
      }
    }
    new Notice(`Basa Push: отправлено ${results.length}${conflicts ? `, конфликтов ${conflicts}` : ""}`);
  }

  async sync() { await this.push(); await this.pull(); }
  async saveSettings() { await this.saveData(this.settings); }
}

class BasaSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("URL Basa").setDesc("Адрес приложения").addText((t) =>
      t.setValue(this.plugin.settings.baseUrl).onChange(async (v) => { this.plugin.settings.baseUrl = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Токен синхронизации").setDesc("Из «Настройки → База знаний · Obsidian»").addText((t) => {
      t.inputEl.type = "password";
      t.setValue(this.plugin.settings.token).onChange(async (v) => { this.plugin.settings.token = v; await this.plugin.saveSettings(); });
    });
    new Setting(containerEl).setName("Папка").setDesc("Куда складывать статьи").addText((t) =>
      t.setValue(this.plugin.settings.folder).onChange(async (v) => { this.plugin.settings.folder = v || "Basa"; await this.plugin.saveSettings(); }));
  }
}

module.exports = BasaSyncPlugin;
