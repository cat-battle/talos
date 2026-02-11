# Talos

Task queue daemon for GitHub Copilot CLI automation. Named after the bronze automaton of Greek mythology.

## Features

- 📋 **Kanban Web UI** — Visual task management with real-time updates
- 💻 **CLI Interface** — Add and manage tasks from the terminal
- ⚡ **Streaming Output** — Live Copilot responses via WebSocket
- 🔐 **Interactive Permissions** — Approve/deny tool usage in real-time
- 📝 **Task Templates** — Quick-start common task types
- 🔄 **Dual Execution Modes** — ACP (streaming) or Prompt (simple) with auto-fallback

## Requirements

- Node.js 18+
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli)
- GitHub CLI authenticated: `gh auth login`

## Quick Start

```bash
git clone https://github.com/cat-battle/talos.git
cd talos
npm start
# Open http://localhost:3000
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Web Browser                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Kanban     │  │   Output     │  │  Permission  │  │
│  │   Board      │  │   Stream     │  │   Prompts    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                           │
                    WebSocket + HTTP
                           │
┌─────────────────────────────────────────────────────────┐
│                   Talos Server                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  REST API    │  │  WebSocket   │  │   Executor   │  │
│  │  /api/*      │  │  /ws         │  │  ACP/Prompt  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                           │
                    ACP Protocol / CLI
                           │
┌─────────────────────────────────────────────────────────┐
│                 GitHub Copilot CLI                      │
│             copilot --acp --stdio                       │
└─────────────────────────────────────────────────────────┘
```

## Usage

### Web UI

1. Open http://localhost:3000
2. Click **+ New Task** or use a template
3. Click **▶ Run** on queued tasks
4. Watch output stream in real-time
5. Approve/deny permissions as needed

### CLI

```bash
# Link CLI globally (optional)
chmod +x cli/index.js
sudo ln -s $(pwd)/cli/index.js /usr/local/bin/talos

# Add tasks
talos add "list all running docker containers"
talos add -t "Cleanup" "remove temp files older than 7 days"

# List tasks
talos list           # All tasks
talos list queue     # Just queued
talos list done      # Completed

# Manage tasks
talos show abc123
talos delete abc123
talos requeue abc123

# Config
talos config
talos config set permissions.allowAllTools false
```

## Configuration

Edit `config.json`:

```json
{
  "pollIntervalMs": 600000,
  "tasksDir": "./tasks",
  "webPort": 3000,
  "copilotCommand": "copilot",
  
  "execution": {
    "mode": "acp",
    "fallbackToPrompt": true
  },
  
  "permissions": {
    "allowAllTools": true,
    "allowAllPaths": false,
    "allowAllUrls": false,
    "allowTools": [],
    "denyTools": [],
    "allowUrls": []
  },
  
  "customInstructions": {
    "enabled": true,
    "globalFile": null,
    "projectFile": ".github/copilot-instructions.md"
  },
  
  "templates": [
    { "id": "review", "title": "Code Review", "prompt": "...", "icon": "🔍" }
  ],
  
  "model": null,
  "planMode": false
}
```

### Execution Modes

| Mode | Description |
|------|-------------|
| `acp` | Agent Client Protocol — streaming, interactive permissions |
| `prompt` | Simple `-p` flag — batch execution, uses config permissions |

### Permission Options

```json
{
  "allowAllTools": false,
  "allowTools": ["shell(git)", "shell(npm)", "write"],
  "denyTools": ["shell(rm)", "shell(sudo)"],
  "allowAllPaths": false,
  "allowAllUrls": false,
  "allowUrls": ["github.com", "api.github.com"]
}
```

### Task Templates

Pre-configured task types for quick creation:

| Template | Prompt |
|----------|--------|
| 🔍 Code Review | Review code changes and identify issues |
| 🧪 Write Tests | Write comprehensive unit tests |
| ♻️ Refactor | Improve code readability and maintainability |
| 📝 Document | Add documentation and comments |
| 🐛 Fix Bug | Identify and fix the described bug |

## API

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks` | List all tasks |
| POST | `/api/tasks` | Create task |
| DELETE | `/api/tasks/:id` | Delete task |
| POST | `/api/tasks/:id/run` | Run task |
| POST | `/api/tasks/move` | Move task between columns |
| GET | `/api/config` | Get config |
| PUT | `/api/config` | Update config |
| GET | `/api/templates` | Get templates |
| POST | `/api/stop` | Stop running task |
| GET | `/api/status` | Server status |

### WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `task_started` | Server→Client | Task execution began |
| `output_chunk` | Server→Client | Streaming text from Copilot |
| `tool_use` | Server→Client | Tool invocation |
| `permission_request` | Server→Client | Approval needed |
| `permission_response` | Client→Server | User's decision |
| `task_completed` | Server→Client | Task finished successfully |
| `task_failed` | Server→Client | Task failed |
| `run_task` | Client→Server | Request to run a task |
| `stop_task` | Client→Server | Request to stop execution |

## Testing

```bash
npm test  # Runs 46 tests
```

Tests cover:
- Task file operations
- Configuration validation
- Command building
- ACP message handling
- Executor logic
- API routes
- CLI commands

## Systemd Service

```bash
sudo tee /etc/systemd/system/talos.service << EOF
[Unit]
Description=Talos Task Queue
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/node $(pwd)/server/index.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable talos
sudo systemctl start talos
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl/Cmd + N` | New task |
| `Escape` | Close modal |

## Copilot CLI Reference

- [About GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli)
- [Using GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli)
- [Custom Instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/add-custom-instructions)
- [ACP Server](https://docs.github.com/en/copilot/reference/acp-server)

## License

MIT
