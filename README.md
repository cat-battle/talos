# Talos

Task queue daemon for GitHub Copilot CLI automation. Named after the bronze automaton of Greek mythology.

## Features

- 📋 **Kanban Web UI** — Visual task management
- 💻 **CLI Interface** — Add and manage tasks from the terminal
- ⚡ **Daemon** — Polls queue and executes tasks via `copilot`
- 📁 **File-based Storage** — Tasks are JSON files, easy to inspect/backup

## Requirements

- Node.js 18+
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli) (the new agent-based CLI)
- GitHub CLI authenticated: `gh auth login`

### Installing Copilot CLI

```bash
# Install via npm (recommended)
npm install -g @githubnext/github-copilot-cli

# Or via gh extension
gh extension install github/gh-copilot
```

## Installation

```bash
# Clone the repo
git clone https://github.com/cat-battle/talos.git
cd talos

# No npm install needed - uses only Node.js built-ins

# Make CLI executable
chmod +x cli/index.js
ln -s $(pwd)/cli/index.js /usr/local/bin/talos
```

## Usage

### Start the Services

```bash
# Start daemon (polls every 10 min by default)
node daemon/index.js

# Start web UI (runs on port 3000)
node web/server.js

# Or run both
npm start
```

### Web UI

Open http://localhost:3000 for the kanban board:
- Create tasks with title, prompt, and type
- View task status and results
- Requeue failed tasks

### CLI

```bash
# Add a task
talos add "list all running docker containers"
talos add -t "Cleanup" "remove temp files older than 7 days"

# List tasks
talos list           # All tasks
talos list queue     # Just queued tasks
talos list done      # Completed tasks

# Show task details
talos show abc123

# Delete a task
talos delete abc123

# Requeue a failed task
talos requeue abc123

# View/update config
talos config
talos config set pollIntervalMs 300000
talos config set allowAllTools false
```

## Configuration

Edit `config.json`:

```json
{
  "pollIntervalMs": 600000,
  "tasksDir": "./tasks",
  "webPort": 3000,
  "copilotCommand": "copilot",
  "allowAllTools": true,
  "allowTools": [],
  "denyTools": [],
  "model": null
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `pollIntervalMs` | number | 600000 | Poll interval in milliseconds (10 min) |
| `tasksDir` | string | "./tasks" | Directory for task files |
| `webPort` | number | 3000 | Web UI port |
| `copilotCommand` | string | "copilot" | Copilot CLI command |
| `allowAllTools` | boolean | true | Allow all tools without approval |
| `allowTools` | array | [] | Specific tools to allow (e.g., `["shell(git)", "write"]`) |
| `denyTools` | array | [] | Specific tools to deny (e.g., `["shell(rm)"]`) |
| `model` | string | null | Model override (default: Claude Sonnet 4.5) |

### Tool Approval

The new Copilot CLI has granular tool approval:

```json
{
  "allowAllTools": false,
  "allowTools": ["shell(git)", "shell(npm)", "write"],
  "denyTools": ["shell(rm)", "shell(sudo)"]
}
```

See [Copilot CLI docs](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli) for details.

## Task Format

Tasks are stored as JSON files in `tasks/{queue,running,done,failed}/`:

```json
{
  "id": "abc12345",
  "title": "List containers",
  "prompt": "list all running docker containers",
  "type": "shell",
  "workingDir": "/home/user/project",
  "createdAt": "2026-02-10T12:00:00.000Z",
  "result": {
    "exitCode": 0,
    "stdout": "...",
    "stderr": "",
    "durationMs": 1234,
    "command": "copilot",
    "args": ["-p", "list all running docker containers", "--allow-all-tools"]
  }
}
```

## Running as a Service (systemd)

```bash
# Create service file
sudo tee /etc/systemd/system/talos.service << EOF
[Unit]
Description=Talos Task Queue Daemon
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/node $(pwd)/daemon/index.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl enable talos
sudo systemctl start talos
```

## Testing

Run the test suite:

```bash
npm test
# or
node --test test/talos.test.js
```

Tests include:
- Task file operations (create, read, move)
- JSON schema validation
- Config operations
- Daemon logic (queue → running → done/failed)
- Web API route existence
- CLI command structure
- Stub command execution (no actual copilot needed)

## Copilot CLI Reference

The daemon uses Copilot CLI's programmatic mode:

```bash
copilot -p "prompt" --allow-all-tools
```

Key options:
- `-p, --prompt` — Run in programmatic mode with given prompt
- `--allow-all-tools` — Allow all tools without approval
- `--allow-tool 'X'` — Allow specific tool (e.g., `shell(git)`, `write`)
- `--deny-tool 'X'` — Deny specific tool
- `--model MODEL` — Specify model

See [GitHub Copilot CLI docs](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli) for full details.

## License

MIT
