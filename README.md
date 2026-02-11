# Talos

Task queue daemon for GitHub Copilot CLI automation. Named after the bronze automaton of Greek mythology.

## Features

- 📋 **Kanban Web UI** — Visual task management with drag-and-drop
- 💻 **CLI Interface** — Add and manage tasks from the terminal
- ⚡ **Daemon** — Polls queue and executes tasks via `gh copilot`
- 📁 **File-based Storage** — Tasks are JSON files, easy to inspect/backup

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

## Requirements

- Node.js 18+
- GitHub CLI (`gh`) with Copilot extension
- Authenticated: `gh auth login`

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
```

## Configuration

Edit `config.json`:

```json
{
  "pollIntervalMs": 600000,    // 10 minutes
  "tasksDir": "./tasks",
  "webPort": 3000,
  "copilotCommand": "gh copilot suggest",
  "yoloMode": true
}
```

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
    "durationMs": 1234
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

## License

MIT
