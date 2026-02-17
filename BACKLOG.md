# Talos Backlog

## In Progress

### Memory & Learning System (feature/memory-layer)
- [x] `memory/` folder structure per project
- [x] Post-task extraction: capture key decisions/patterns
- [x] Pre-task injection: include relevant memory as context
- [ ] Semantic search over past task outputs
- [ ] Custom instructions evolution (auto-update copilot-instructions.md)
- [x] Pattern tracking (tools that worked/failed, timing estimates)

## Backlog

### Task Management
- [ ] Task chaining — reference outputs of previous tasks
- [ ] Session resume — use Copilot's `--resume` flag
- [ ] Task dependencies — define prerequisite tasks
- [ ] Batch execution — run multiple tasks sequentially

### UI Enhancements
- [ ] WebSocket real-time updates (no manual refresh needed)
- [ ] Working directory autocomplete (browse server filesystem)
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

## Completed

### v0.1.1 (2026-02-16)
- [x] Agent abstraction layer (BaseAgent interface)
- [x] CopilotAgent and ClaudeCodeAgent adapters  
- [x] Agent auto-detection and selection
- [x] Claude Code stdin pipe fix (resolve -p hanging)
- [x] /api/agents endpoint
- [x] End-to-end testing with both agents
- [x] 61 tests passing

### v0.1.0
- [x] Kanban web UI with real-time streaming
- [x] ACP integration with fallback to prompt mode
- [x] Interactive permission prompts
- [x] Task templates (Code Review, Tests, Refactor, etc.)
- [x] CLI with add, list, show, stats, export
- [x] 46 tests, GitHub Actions CI
- [x] Ubuntu install script
