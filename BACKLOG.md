# Talos Backlog

## In Progress (feature/memory-layer)

### Memory & Learning System
- [ ] `memory/` folder structure per project
- [ ] Post-task extraction: capture key decisions/patterns
- [ ] Pre-task injection: include relevant memory as context
- [ ] Semantic search over past task outputs
- [ ] Custom instructions evolution (auto-update copilot-instructions.md)
- [ ] Pattern tracking (tools that worked/failed, timing estimates)

## Backlog

### Task Management
- [ ] Task chaining — reference outputs of previous tasks
- [ ] Session resume — use Copilot's `--resume` flag
- [ ] Task dependencies — define prerequisite tasks
- [ ] Batch execution — run multiple tasks sequentially

### UI Enhancements
- [ ] Plan mode toggle in UI
- [ ] Output search/filter
- [ ] Quick-add in header (no modal)
- [ ] Task duration estimates based on history

### Integrations
- [ ] MCP server integration
- [ ] GitHub PR creation from task results
- [ ] Notifications (desktop/Telegram) on task completion
- [ ] Import tasks from GitHub issues

### Developer Experience
- [ ] Auto-approve patterns (remember permission grants)
- [ ] Project profiles (different configs per repo)
- [ ] Task templates from file (load from .github/talos/)

## Completed (v0.1.0)

- [x] Kanban web UI with real-time streaming
- [x] ACP integration with fallback to prompt mode
- [x] Interactive permission prompts
- [x] Task templates (Code Review, Tests, Refactor, etc.)
- [x] CLI with add, list, show, stats, export
- [x] 46 tests, GitHub Actions CI
- [x] Ubuntu install script
