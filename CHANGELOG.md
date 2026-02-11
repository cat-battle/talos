# Changelog

All notable changes to Talos will be documented in this file.

## [0.1.0] - 2026-02-11

### Added
- Initial release
- **Web UI**
  - Kanban board with Queue, Running, Done, Failed columns
  - Real-time output streaming via WebSocket
  - Interactive permission approval/denial
  - Task templates for quick creation
  - Stop button to cancel running tasks
  - Keyboard shortcuts (Ctrl+N for new task, Esc to close)
  
- **CLI**
  - `talos add` - Create tasks (supports templates)
  - `talos list` - List tasks by status
  - `talos show` - Display task details
  - `talos delete` - Remove tasks
  - `talos requeue` - Move done/failed tasks back to queue
  - `talos config` - View/edit configuration
  - `talos templates` - List available templates
  - `talos stats` - Show task statistics
  - `talos export` - Export task results to markdown

- **Server**
  - Combined HTTP + WebSocket server
  - ACP (Agent Client Protocol) integration for streaming
  - Fallback to prompt mode when ACP unavailable
  - REST API for task management
  - Health check endpoint
  - Stats endpoint

- **Execution**
  - Dual mode: ACP (streaming) or Prompt (simple)
  - Auto-fallback from ACP to prompt on failure
  - Configurable tool permissions
  - Path and URL permission controls

- **Configuration**
  - Task templates
  - Permission settings (allowAllTools, allowTools, denyTools)
  - Path permissions (allowAllPaths)
  - URL permissions (allowAllUrls, allowUrls)
  - Model selection
  - Plan mode toggle

- **Testing**
  - 46 tests across 12 test suites
  - Task operations, config, executor, ACP, CLI coverage

### Technical Details
- Built for GitHub Copilot CLI (new agent-based version)
- Uses ACP protocol for streaming communication
- Pure Node.js, no external dependencies
- WebSocket for real-time updates
- JSON file-based task storage
