# Task Roulette

An Obsidian plugin that beats decision fatigue: press **Spin** and let chance pick your next task — tombala style.

## Features

- **Multiple task lists** managed inside the plugin, plus **markdown-backed lists** that read tasks straight from any note in your vault.
- Every task has an **estimated duration** and a **period** (daily / weekly / monthly). Once a task is accepted, it leaves the pool until its period rolls over — no more "it picked the same thing again".
- **Filters** before spinning: pick a list, a period, or "give me something under 30 minutes".
- **Templates**: import ready-made lists (Household Chores, Personal Growth, Health & Fitness) and edit them freely — names, durations, periods.
- **History calendar**: a month view showing how many tasks you completed each day, with per-day details and totals.
- Optionally **appends the accepted task to today's daily note** as a checkbox.

## Usage

- Click the dice icon in the ribbon, or run the command **"Task Roulette: Spin the wheel"**.
- Choose filters if you want, hit **Spin**, then **Accept**, **Spin again**, or **Skip today**.
- See your track record with **"Task Roulette: Open history calendar"**.

### Markdown note lists

Point the plugin at any note in *Settings → Task Roulette → Markdown note lists*. Each bullet or unchecked checkbox becomes a task:

```markdown
- Read a chapter (25m) #weekly
- [ ] Water the plants (5m)
- Review flashcards
```

Duration in parentheses (defaults to 30 minutes), period as a `#daily` / `#weekly` / `#monthly` tag (defaults to daily). Checked items (`- [x]`) are ignored.

## Manual installation

Copy `manifest.json`, `main.js`, and `styles.css` into `<your vault>/.obsidian/plugins/task-roulette/`, then enable **Task Roulette** in *Settings → Community plugins*.
