#!/usr/bin/env node
/**
 * Talos CLI
 * Command-line interface for task management
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getTasksDir() {
  const config = loadConfig();
  return path.resolve(path.dirname(CONFIG_PATH), config.tasksDir);
}

function readTasks(status) {
  const dir = path.join(getTasksDir(), status);
  if (!fs.existsSync(dir)) return [];
  
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const content = fs.readFileSync(path.join(dir, f), 'utf-8');
      return { ...JSON.parse(content), _status: status };
    });
}

function printHelp() {
  console.log(`
Talos - Task Queue CLI

Usage: talos <command> [options]

Commands:
  add <prompt>          Add a new task to the queue
  list [status]         List tasks (all, queue, running, done, failed)
  show <id>             Show task details
  delete <id>           Delete a task
  requeue <id>          Move failed/done task back to queue
  config                Show current configuration
  config set <key> <val> Update configuration

Options:
  -t, --title <title>   Task title (for add command)
  --type <type>         Task type: shell, gh, git (default: shell)
  -d, --dir <path>      Working directory for task
  -h, --help            Show this help

Examples:
  talos add "list all docker containers"
  talos add -t "Cleanup logs" "remove log files older than 7 days"
  talos list queue
  talos show abc123
  talos config set pollIntervalMs 300000
`);
}

function parseArgs(args) {
  const result = { _: [] };
  let i = 0;
  
  while (i < args.length) {
    const arg = args[i];
    
    if (arg === '-t' || arg === '--title') {
      result.title = args[++i];
    } else if (arg === '--type') {
      result.type = args[++i];
    } else if (arg === '-d' || arg === '--dir') {
      result.dir = args[++i];
    } else if (arg === '-h' || arg === '--help') {
      result.help = true;
    } else if (!arg.startsWith('-')) {
      result._.push(arg);
    }
    i++;
  }
  
  return result;
}

function cmdAdd(args) {
  const prompt = args._.slice(1).join(' ');
  
  if (!prompt) {
    console.error('Error: Prompt is required');
    console.log('Usage: talos add <prompt>');
    process.exit(1);
  }

  const task = {
    id: randomUUID().slice(0, 8),
    title: args.title || prompt.slice(0, 50) + (prompt.length > 50 ? '...' : ''),
    prompt: prompt,
    type: args.type || 'shell',
    workingDir: args.dir || null,
    createdAt: new Date().toISOString()
  };

  const queueDir = path.join(getTasksDir(), 'queue');
  if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, { recursive: true });
  
  const filename = `${task.id}.json`;
  fs.writeFileSync(path.join(queueDir, filename), JSON.stringify(task, null, 2));
  
  console.log(`✓ Task created: ${task.id}`);
  console.log(`  Title: ${task.title}`);
  console.log(`  Type: ${task.type}`);
}

function cmdList(args) {
  const status = args._[1] || 'all';
  const statuses = status === 'all' 
    ? ['queue', 'running', 'done', 'failed']
    : [status];

  for (const s of statuses) {
    const tasks = readTasks(s);
    
    console.log(`\n${s.toUpperCase()} (${tasks.length})`);
    console.log('─'.repeat(50));
    
    if (tasks.length === 0) {
      console.log('  (empty)');
    } else {
      for (const t of tasks) {
        const time = new Date(t.createdAt).toLocaleString();
        console.log(`  ${t.id}  ${t.title.slice(0, 35).padEnd(35)}  ${time}`);
      }
    }
  }
  console.log('');
}

function cmdShow(args) {
  const taskId = args._[1];
  
  if (!taskId) {
    console.error('Error: Task ID is required');
    process.exit(1);
  }

  for (const status of ['queue', 'running', 'done', 'failed']) {
    const tasks = readTasks(status);
    const task = tasks.find(t => t.id === taskId || t.id.startsWith(taskId));
    
    if (task) {
      console.log(`\nTask: ${task.id} (${status})`);
      console.log('─'.repeat(50));
      console.log(`Title:   ${task.title}`);
      console.log(`Type:    ${task.type}`);
      console.log(`Created: ${new Date(task.createdAt).toLocaleString()}`);
      if (task.workingDir) console.log(`WorkDir: ${task.workingDir}`);
      console.log(`\nPrompt:\n${task.prompt}`);
      
      if (task.result) {
        console.log(`\nResult:`);
        console.log(`  Exit Code: ${task.result.exitCode}`);
        console.log(`  Duration:  ${task.result.durationMs ? (task.result.durationMs / 1000).toFixed(1) + 's' : 'N/A'}`);
        
        if (task.result.stdout) {
          console.log(`\nstdout:\n${task.result.stdout}`);
        }
        if (task.result.stderr) {
          console.log(`\nstderr:\n${task.result.stderr}`);
        }
      }
      console.log('');
      return;
    }
  }
  
  console.error(`Task not found: ${taskId}`);
  process.exit(1);
}

function cmdDelete(args) {
  const taskId = args._[1];
  
  if (!taskId) {
    console.error('Error: Task ID is required');
    process.exit(1);
  }

  const tasksDir = getTasksDir();
  
  for (const status of ['queue', 'running', 'done', 'failed']) {
    const dir = path.join(tasksDir, status);
    if (!fs.existsSync(dir)) continue;
    
    const files = fs.readdirSync(dir).filter(f => f.startsWith(taskId) && f.endsWith('.json'));
    
    if (files.length > 0) {
      fs.unlinkSync(path.join(dir, files[0]));
      console.log(`✓ Deleted task: ${taskId}`);
      return;
    }
  }
  
  console.error(`Task not found: ${taskId}`);
  process.exit(1);
}

function cmdRequeue(args) {
  const taskId = args._[1];
  
  if (!taskId) {
    console.error('Error: Task ID is required');
    process.exit(1);
  }

  const tasksDir = getTasksDir();
  
  for (const status of ['done', 'failed']) {
    const dir = path.join(tasksDir, status);
    if (!fs.existsSync(dir)) continue;
    
    const files = fs.readdirSync(dir).filter(f => f.startsWith(taskId) && f.endsWith('.json'));
    
    if (files.length > 0) {
      const oldPath = path.join(dir, files[0]);
      const newPath = path.join(tasksDir, 'queue', files[0]);
      
      // Load task, clear result, update timestamp
      const task = JSON.parse(fs.readFileSync(oldPath, 'utf-8'));
      delete task.result;
      task.createdAt = new Date().toISOString();
      
      fs.writeFileSync(newPath, JSON.stringify(task, null, 2));
      fs.unlinkSync(oldPath);
      
      console.log(`✓ Requeued task: ${taskId}`);
      return;
    }
  }
  
  console.error(`Task not found in done/failed: ${taskId}`);
  process.exit(1);
}

function cmdConfig(args) {
  const config = loadConfig();
  
  if (args._[1] === 'set' && args._[2] && args._[3] !== undefined) {
    const key = args._[2];
    let value = args._[3];
    
    // Parse numbers
    if (!isNaN(value)) {
      value = Number(value);
    }
    // Parse booleans
    if (value === 'true') value = true;
    if (value === 'false') value = false;
    
    config[key] = value;
    saveConfig(config);
    console.log(`✓ Set ${key} = ${JSON.stringify(value)}`);
  } else {
    console.log('\nConfiguration:');
    console.log('─'.repeat(40));
    for (const [key, value] of Object.entries(config)) {
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    }
    console.log('');
  }
}

// Main
const args = parseArgs(process.argv.slice(2));

if (args.help || args._.length === 0) {
  printHelp();
  process.exit(0);
}

const command = args._[0];

switch (command) {
  case 'add':
    cmdAdd(args);
    break;
  case 'list':
  case 'ls':
    cmdList(args);
    break;
  case 'show':
    cmdShow(args);
    break;
  case 'delete':
  case 'rm':
    cmdDelete(args);
    break;
  case 'requeue':
    cmdRequeue(args);
    break;
  case 'config':
    cmdConfig(args);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
