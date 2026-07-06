"use strict";

const {
	Plugin,
	Modal,
	Notice,
	Setting,
	PluginSettingTab,
	ButtonComponent,
	AbstractInputSuggest,
	TFile,
	normalizePath,
	moment,
} = require("obsidian");

/* ------------------------------------------------------------------ */
/* Defaults & templates                                                */
/* ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = () => ({
	lists: [],
	markdownSources: [],
	history: [],
	skips: [],
	addToDailyNote: true,
});

const TEMPLATE_PACKS = [
	{
		name: "Household Chores",
		tasks: [
			{ name: "Clean your room", duration: 30, period: "weekly" },
			{ name: "Do the dishes", duration: 15, period: "daily" },
			{ name: "Take out the trash", duration: 5, period: "daily" },
			{ name: "Do the laundry", duration: 40, period: "weekly" },
			{ name: "Vacuum the house", duration: 25, period: "weekly" },
			{ name: "Organize your desk", duration: 15, period: "weekly" },
			{ name: "Deep clean the bathroom", duration: 45, period: "monthly" },
			{ name: "Declutter your wardrobe", duration: 60, period: "monthly" },
		],
	},
	{
		name: "Personal Growth",
		tasks: [
			{ name: "Read 20 pages", duration: 30, period: "daily" },
			{ name: "Practice a language", duration: 20, period: "daily" },
			{ name: "Watch an educational video", duration: 25, period: "daily" },
			{ name: "Write in your journal", duration: 15, period: "daily" },
			{ name: "Work on a new skill", duration: 30, period: "daily" },
			{ name: "Review your weekly goals", duration: 20, period: "weekly" },
			{ name: "Plan the month ahead", duration: 30, period: "monthly" },
		],
	},
	{
		name: "Health & Fitness",
		tasks: [
			{ name: "Stretch", duration: 10, period: "daily" },
			{ name: "Go for a walk", duration: 30, period: "daily" },
			{ name: "Work out", duration: 45, period: "daily" },
			{ name: "Meditate", duration: 10, period: "daily" },
			{ name: "Meal prep", duration: 60, period: "weekly" },
			{ name: "Try a new healthy recipe", duration: 45, period: "weekly" },
		],
	},
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function genId() {
	return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function todayStr() {
	return moment().format("YYYY-MM-DD");
}

/** Is dateStr in the same (current) day/week/month as today, given the task period? */
function isSameCurrentPeriod(dateStr, period) {
	const unit = period === "daily" ? "day" : period === "weekly" ? "week" : "month";
	return moment(dateStr, "YYYY-MM-DD").isSame(moment(), unit);
}

function formatDuration(min) {
	if (min >= 60) {
		const h = Math.floor(min / 60);
		const m = min % 60;
		return m ? h + "h " + m + "m" : h + "h";
	}
	return min + "m";
}

function removeItem(arr, item) {
	const i = arr.indexOf(item);
	if (i >= 0) arr.splice(i, 1);
}

/** Parse tasks out of a markdown note.
 *  Syntax per line:  - Task name (25m) #weekly
 *  Defaults: 30 minutes, daily. Checked checkboxes are skipped. */
async function parseMarkdownTasks(app, path) {
	const file = app.vault.getAbstractFileByPath(normalizePath(path || ""));
	if (!(file instanceof TFile)) return [];
	const content = await app.vault.cachedRead(file);
	const out = [];
	for (const line of content.split("\n")) {
		const m = line.match(/^\s*[-*]\s*(?:\[(.)\]\s*)?(.+)$/);
		if (!m) continue;
		if (m[1] && m[1] !== " ") continue; // completed checkbox -> not a candidate
		let name = m[2].trim();
		let duration = 30;
		let period = "daily";
		const dur = name.match(/\((\d+)\s*(?:m|min|mins|minutes)?\)/i);
		if (dur) {
			duration = parseInt(dur[1], 10);
			name = name.replace(dur[0], "").trim();
		}
		const per = name.match(/#(daily|weekly|monthly)\b/i);
		if (per) {
			period = per[1].toLowerCase();
			name = name.replace(per[0], "").trim();
		}
		if (!name) continue;
		out.push({
			id: "md:" + file.path + ":" + name,
			name,
			duration,
			period,
			listName: file.basename,
		});
	}
	return out;
}

/* ------------------------------------------------------------------ */
/* Spin modal                                                          */
/* ------------------------------------------------------------------ */

class SpinModal extends Modal {
	constructor(app, plugin) {
		super(app);
		this.plugin = plugin;
		this.listChoice = "all";
		this.periodChoice = "any";
		this.maxDuration = null;
		this.spinning = false;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("tr-spin-modal");
		this.titleEl.setText("Task Roulette");

		new Setting(contentEl).setName("List").addDropdown((d) => {
			d.addOption("all", "All lists");
			for (const l of this.plugin.settings.lists) d.addOption("list:" + l.id, l.name);
			for (const s of this.plugin.settings.markdownSources)
				d.addOption("md:" + s.id, "📄 " + (s.path || "(no note selected)"));
			d.setValue(this.listChoice).onChange((v) => (this.listChoice = v));
		});

		new Setting(contentEl).setName("Period").addDropdown((d) =>
			d
				.addOption("any", "Any")
				.addOption("daily", "Daily")
				.addOption("weekly", "Weekly")
				.addOption("monthly", "Monthly")
				.setValue(this.periodChoice)
				.onChange((v) => (this.periodChoice = v))
		);

		new Setting(contentEl)
			.setName("Max duration (minutes)")
			.setDesc("Only pick tasks that fit the time you have. Leave empty for no limit.")
			.addText((t) => {
				t.inputEl.type = "number";
				t.setPlaceholder("e.g. 30").onChange((v) => {
					const n = parseInt(v, 10);
					this.maxDuration = isNaN(n) || n <= 0 ? null : n;
				});
			});

		this.displayEl = contentEl.createDiv({ cls: "tr-display", text: "Ready when you are 🎲" });
		this.metaEl = contentEl.createDiv({ cls: "tr-result-meta" });
		this.buttonsEl = contentEl.createDiv({ cls: "tr-buttons" });
		this.renderSpinButton();
	}

	renderSpinButton(label) {
		this.buttonsEl.empty();
		new ButtonComponent(this.buttonsEl)
			.setButtonText(label || "Spin")
			.setCta()
			.onClick(() => this.spin());
	}

	async spin() {
		if (this.spinning) return;
		const s = this.plugin.settings;
		const hasAnyTask =
			s.lists.some((l) => l.tasks.length > 0) || s.markdownSources.length > 0;
		this.metaEl.empty();
		if (!hasAnyTask) {
			this.displayEl.setText(
				"No tasks yet. Open Settings → Task Roulette to add a list or import a template."
			);
			return;
		}

		const candidates = await this.plugin.getCandidates(
			this.listChoice,
			this.periodChoice,
			this.maxDuration
		);
		if (candidates.length === 0) {
			this.displayEl.setText(
				"Nothing matches your filters — or everything for this period is already done 🎉"
			);
			this.renderSpinButton("Spin again");
			return;
		}

		const pick = candidates[Math.floor(Math.random() * candidates.length)];
		this.spinning = true;
		this.buttonsEl.empty();
		this.displayEl.addClass("tr-spinning");

		let delay = 50;
		const tick = () => {
			if (delay >= 320) {
				this.displayEl.removeClass("tr-spinning");
				this.spinning = false;
				this.showResult(pick);
				return;
			}
			const rnd = candidates[Math.floor(Math.random() * candidates.length)];
			this.displayEl.setText(rnd.name);
			delay *= 1.18;
			window.setTimeout(tick, delay);
		};
		tick();
	}

	showResult(pick) {
		this.displayEl.setText(pick.name);
		this.metaEl.setText(
			"⏱ " + formatDuration(pick.duration) + " · " + pick.period + " · " + pick.listName
		);
		this.buttonsEl.empty();
		new ButtonComponent(this.buttonsEl)
			.setButtonText("Accept ✓")
			.setCta()
			.onClick(async () => {
				await this.plugin.recordCompletion(pick);
				new Notice("Locked in: " + pick.name);
				this.close();
			});
		new ButtonComponent(this.buttonsEl).setButtonText("Spin again").onClick(() => this.spin());
		new ButtonComponent(this.buttonsEl).setButtonText("Skip today").onClick(async () => {
			await this.plugin.skipToday(pick);
			this.metaEl.empty();
			this.spin();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

/* ------------------------------------------------------------------ */
/* History calendar modal                                              */
/* ------------------------------------------------------------------ */

class HistoryModal extends Modal {
	constructor(app, plugin) {
		super(app);
		this.plugin = plugin;
		this.month = moment().startOf("month");
		this.selectedDate = todayStr();
	}

	onOpen() {
		this.contentEl.addClass("tr-history-modal");
		this.titleEl.setText("History");
		this.render();
	}

	byDate() {
		const map = new Map();
		for (const r of this.plugin.settings.history) {
			if (!map.has(r.date)) map.set(r.date, []);
			map.get(r.date).push(r);
		}
		return map;
	}

	render() {
		const { contentEl } = this;
		contentEl.empty();
		const byDate = this.byDate();

		const nav = contentEl.createDiv({ cls: "tr-cal-nav" });
		new ButtonComponent(nav).setIcon("chevron-left").onClick(() => {
			this.month = this.month.clone().subtract(1, "month");
			this.render();
		});
		nav.createSpan({ cls: "tr-cal-title", text: this.month.format("MMMM YYYY") });
		new ButtonComponent(nav).setIcon("chevron-right").onClick(() => {
			this.month = this.month.clone().add(1, "month");
			this.render();
		});

		const monthKey = this.month.format("YYYY-MM");
		let count = 0;
		let minutes = 0;
		for (const r of this.plugin.settings.history) {
			if (r.date.startsWith(monthKey)) {
				count++;
				minutes += r.duration || 0;
			}
		}
		contentEl.createDiv({
			cls: "tr-cal-summary",
			text: count
				? count + (count === 1 ? " task" : " tasks") + " completed this month · " + formatDuration(minutes) + " total"
				: "No tasks completed this month yet.",
		});

		const grid = contentEl.createDiv({ cls: "tr-cal-grid" });
		for (const label of moment.weekdaysMin(true))
			grid.createDiv({ cls: "tr-cal-weekday", text: label });

		const offset = this.month.clone().startOf("month").weekday();
		for (let i = 0; i < offset; i++) grid.createDiv({ cls: "tr-cal-cell tr-cal-blank" });

		const days = this.month.daysInMonth();
		for (let d = 1; d <= days; d++) {
			const dateStr = this.month.clone().date(d).format("YYYY-MM-DD");
			const cell = grid.createDiv({ cls: "tr-cal-cell" });
			if (dateStr === todayStr()) cell.addClass("tr-today");
			if (dateStr === this.selectedDate) cell.addClass("tr-selected");
			cell.createSpan({ cls: "tr-cal-day", text: String(d) });
			const recs = byDate.get(dateStr);
			if (recs && recs.length) cell.createSpan({ cls: "tr-cal-count", text: String(recs.length) });
			cell.addEventListener("click", () => {
				this.selectedDate = dateStr;
				this.render();
			});
		}

		const details = contentEl.createDiv({ cls: "tr-cal-details" });
		details.createEl("h4", {
			text: moment(this.selectedDate, "YYYY-MM-DD").format("dddd, MMM D"),
		});
		const recs = byDate.get(this.selectedDate) || [];
		if (!recs.length) {
			details.createDiv({ cls: "tr-cal-empty-note", text: "Nothing completed on this day." });
		} else {
			for (const r of recs) {
				const row = details.createDiv({ cls: "tr-cal-record" });
				row.createSpan({ cls: "tr-cal-record-name", text: "✓ " + r.taskName });
				row.createSpan({
					cls: "tr-cal-record-meta",
					text: formatDuration(r.duration) + " · " + r.listName,
				});
				const del = row.createSpan({ cls: "tr-cal-record-delete", text: "✕" });
				del.setAttr("aria-label", "Remove this record");
				del.addEventListener("click", async () => {
					removeItem(this.plugin.settings.history, r);
					await this.plugin.saveSettings();
					this.render();
				});
			}
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

/* ------------------------------------------------------------------ */
/* Settings tab                                                        */
/* ------------------------------------------------------------------ */

class FileSuggest extends AbstractInputSuggest {
	constructor(app, inputEl, onPick) {
		super(app, inputEl);
		this.inputElRef = inputEl;
		this.onPick = onPick;
	}

	getSuggestions(query) {
		const q = (query || "").toLowerCase();
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.toLowerCase().includes(q))
			.slice(0, 20);
	}

	renderSuggestion(file, el) {
		el.setText(file.path);
	}

	selectSuggestion(file) {
		this.inputElRef.value = file.path;
		this.onPick(file);
		this.close();
	}
}

class TaskRouletteSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.templateChoice = 0;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Add accepted task to daily note")
			.setDesc("When you accept a spin result, append it as a checkbox to today's daily note.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.addToDailyNote).onChange(async (v) => {
					this.plugin.settings.addToDailyNote = v;
					await this.plugin.saveSettings();
				})
			);

		/* Templates ---------------------------------------------------- */
		new Setting(containerEl).setName("Templates").setHeading();
		new Setting(containerEl)
			.setName("Import a template")
			.setDesc("Adds a ready-made list. Everything is editable after import — names, durations, periods.")
			.addDropdown((d) => {
				TEMPLATE_PACKS.forEach((p, i) => d.addOption(String(i), p.name));
				d.setValue(String(this.templateChoice)).onChange((v) => (this.templateChoice = parseInt(v, 10)));
			})
			.addButton((b) =>
				b
					.setButtonText("Import")
					.setCta()
					.onClick(async () => {
						const pack = TEMPLATE_PACKS[this.templateChoice];
						this.plugin.settings.lists.push({
							id: genId(),
							name: pack.name,
							tasks: pack.tasks.map((t) => Object.assign({ id: genId() }, t)),
						});
						await this.plugin.saveSettings();
						new Notice('Imported "' + pack.name + '"');
						this.display();
					})
			);

		/* Lists ---------------------------------------------------------- */
		new Setting(containerEl).setName("Your lists").setHeading();
		for (const list of this.plugin.settings.lists) this.renderList(containerEl, list);
		new Setting(containerEl).addButton((b) =>
			b.setButtonText("+ New list").onClick(async () => {
				this.plugin.settings.lists.push({ id: genId(), name: "New list", tasks: [] });
				await this.plugin.saveSettings();
				this.display();
			})
		);

		/* Markdown note sources ------------------------------------------ */
		new Setting(containerEl).setName("Markdown note lists").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"Pull tasks straight from a note in your vault. Each bullet or unchecked checkbox becomes a task. " +
				'Add a duration in parentheses and a period tag, e.g. "- Read a chapter (25m) #weekly". ' +
				"Defaults: 30 minutes, daily. Checked items are ignored.",
		});
		for (const src of this.plugin.settings.markdownSources) {
			const s = new Setting(containerEl);
			s.setClass("tr-task-row");
			s.addText((t) => {
				t.setPlaceholder("Path/To/Note.md")
					.setValue(src.path)
					.onChange(async (v) => {
						src.path = v;
						await this.plugin.saveSettings();
					});
				t.inputEl.addClass("tr-path-input");
				new FileSuggest(this.app, t.inputEl, async (f) => {
					src.path = f.path;
					await this.plugin.saveSettings();
				});
			});
			s.addButton((b) =>
				b
					.setIcon("trash")
					.setTooltip("Remove")
					.onClick(async () => {
						removeItem(this.plugin.settings.markdownSources, src);
						await this.plugin.saveSettings();
						this.display();
					})
			);
		}
		new Setting(containerEl).addButton((b) =>
			b.setButtonText("+ Add markdown note").onClick(async () => {
				this.plugin.settings.markdownSources.push({ id: genId(), path: "" });
				await this.plugin.saveSettings();
				this.display();
			})
		);

		/* History --------------------------------------------------------- */
		new Setting(containerEl).setName("History").setHeading();
		new Setting(containerEl)
			.setName("Clear history")
			.setDesc(
				this.plugin.settings.history.length +
					" completion record(s) stored. Clearing also resets the daily/weekly/monthly rotation."
			)
			.addButton((b) =>
				b
					.setButtonText("Clear")
					.setWarning()
					.onClick(async () => {
						if (!confirm("Delete all completion history? This cannot be undone.")) return;
						this.plugin.settings.history = [];
						this.plugin.settings.skips = [];
						await this.plugin.saveSettings();
						this.display();
					})
			);
	}

	renderList(containerEl, list) {
		const header = new Setting(containerEl);
		header.setClass("tr-list-header");
		header.addText((t) => {
			t.setValue(list.name).onChange(async (v) => {
				list.name = v;
				await this.plugin.saveSettings();
			});
			t.inputEl.addClass("tr-list-name-input");
		});
		header.addButton((b) =>
			b
				.setIcon("plus")
				.setTooltip("Add task")
				.onClick(async () => {
					list.tasks.push({ id: genId(), name: "", duration: 30, period: "daily" });
					await this.plugin.saveSettings();
					this.display();
				})
		);
		header.addButton((b) =>
			b
				.setIcon("trash")
				.setTooltip("Delete list")
				.setWarning()
				.onClick(async () => {
					if (!confirm('Delete the list "' + list.name + '" and its ' + list.tasks.length + " task(s)?"))
						return;
					removeItem(this.plugin.settings.lists, list);
					await this.plugin.saveSettings();
					this.display();
				})
		);

		for (const task of list.tasks) {
			const row = new Setting(containerEl);
			row.setClass("tr-task-row");
			row.addText((t) => {
				t.setPlaceholder("Task name")
					.setValue(task.name)
					.onChange(async (v) => {
						task.name = v;
						await this.plugin.saveSettings();
					});
				t.inputEl.addClass("tr-task-name-input");
			});
			row.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.addClass("tr-duration-input");
				t.setValue(String(task.duration)).onChange(async (v) => {
					const n = parseInt(v, 10);
					if (!isNaN(n) && n > 0) {
						task.duration = n;
						await this.plugin.saveSettings();
					}
				});
			});
			row.addDropdown((d) =>
				d
					.addOption("daily", "Daily")
					.addOption("weekly", "Weekly")
					.addOption("monthly", "Monthly")
					.setValue(task.period)
					.onChange(async (v) => {
						task.period = v;
						await this.plugin.saveSettings();
					})
			);
			row.addButton((b) =>
				b
					.setIcon("trash")
					.setTooltip("Delete task")
					.onClick(async () => {
						removeItem(list.tasks, task);
						await this.plugin.saveSettings();
						this.display();
					})
			);
		}
	}
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

class TaskRoulettePlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		// Old skip entries are only noise — keep today's.
		const today = todayStr();
		this.settings.skips = this.settings.skips.filter((s) => s.date === today);

		this.addRibbonIcon("dices", "Task Roulette: spin", () => new SpinModal(this.app, this).open());

		this.addCommand({
			id: "spin",
			name: "Spin the wheel",
			callback: () => new SpinModal(this.app, this).open(),
		});
		this.addCommand({
			id: "history",
			name: "Open history calendar",
			callback: () => new HistoryModal(this.app, this).open(),
		});

		this.addSettingTab(new TaskRouletteSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign(DEFAULT_SETTINGS(), await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** All tasks that pass list/period/duration filters and are not on cooldown. */
	async getCandidates(listChoice, period, maxDuration) {
		const out = [];
		for (const list of this.settings.lists) {
			if (listChoice !== "all" && listChoice !== "list:" + list.id) continue;
			for (const t of list.tasks)
				if (t.name && t.name.trim()) out.push(Object.assign({}, t, { listName: list.name }));
		}
		for (const src of this.settings.markdownSources) {
			if (listChoice !== "all" && listChoice !== "md:" + src.id) continue;
			out.push(...(await parseMarkdownTasks(this.app, src.path)));
		}

		const today = todayStr();
		return out.filter(
			(t) =>
				(period === "any" || t.period === period) &&
				(maxDuration == null || t.duration <= maxDuration) &&
				!this.settings.skips.some((s) => s.taskId === t.id && s.date === today) &&
				!this.settings.history.some(
					(r) => r.taskId === t.id && isSameCurrentPeriod(r.date, t.period)
				)
		);
	}

	async recordCompletion(task) {
		this.settings.history.push({
			date: todayStr(),
			taskId: task.id,
			taskName: task.name,
			listName: task.listName,
			duration: task.duration,
			period: task.period,
		});
		await this.saveSettings();
		if (this.settings.addToDailyNote) await this.appendToDailyNote(task);
	}

	async skipToday(task) {
		this.settings.skips.push({ taskId: task.id, date: todayStr() });
		await this.saveSettings();
	}

	async appendToDailyNote(task) {
		try {
			const dn =
				this.app.internalPlugins &&
				this.app.internalPlugins.getPluginById &&
				this.app.internalPlugins.getPluginById("daily-notes");
			const opts = (dn && dn.instance && dn.instance.options) || {};
			const format = opts.format || "YYYY-MM-DD";
			const folder = (opts.folder || "").trim();
			const path = normalizePath((folder ? folder + "/" : "") + moment().format(format) + ".md");
			const line = "- [ ] " + task.name + " (⏱ " + formatDuration(task.duration) + ")";

			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) {
				await this.app.vault.process(existing, (data) => {
					const body = data.length && !data.endsWith("\n") ? data + "\n" : data;
					return body + line + "\n";
				});
			} else {
				const parent = path.contains("/") ? path.slice(0, path.lastIndexOf("/")) : "";
				if (parent && !this.app.vault.getAbstractFileByPath(parent)) {
					try {
						await this.app.vault.createFolder(parent);
					} catch (e) {
						/* folder may already exist */
					}
				}
				await this.app.vault.create(path, line + "\n");
			}
			new Notice("Added to daily note ✓");
		} catch (e) {
			console.error("Task Roulette: failed to append to daily note", e);
			new Notice("Task Roulette: couldn't add to daily note.");
		}
	}
}

module.exports = TaskRoulettePlugin;
