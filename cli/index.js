#!/usr/bin/env node
/**
 * Talos CLI
 * Command-line interface for task management
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

// Find config path (supports TALOS_CONFIG env var)
const CONFIG_PATH = process.env.TALOS_CONFIG || path.join(__dirname, '..', 'config.json');

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
Talos - GitHub Copilot CLI Task Queue

Usage: talos <command> [options]

Commands:
  add <prompt>          Add a new task to the queue
  list [status]         List tasks (all, queue, running, done, failed)
  show <id>             Show task details
  delete <id>           Delete a task
  requeue <id>          Move failed/done task back to queue
  config                Show current configuration
  config get <key>      Get a config value
  config set <key> <val> Update configuration
  templates             List available templates
  stats                 Show task statistics
  export <id> [file]    Export task result to file

Options:
  -t, --title <title>   Task title (for add command)
  --type <type>         Task type: shell, gh, git (default: shell)
  -d, --dir <path>      Working directory for task
  --template <id>       Use a template (for add command)
  -h, --help            Show this help

Examples:
  talos add "list all docker containers"
  talos add -t "Cleanup" "remove log files older than 7 days"
  talos add --template code-review
  talos list queue
  talos show abc123
  talos export abc123 output.md
  talos config set permissions.allowAllTools false
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
    } else if (arg === '--template') {
      result.template = args[++i];
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
  const config = loadConfig();
  let prompt = args._.slice(1).join(' ');
  let title = args.title;

  // Use template if specified
  if (args.template) {
    const templates = config.templates || [];
    const template = templates.find(t => t.id === args.template);
    if (!template) {
      console.error(`Template not found: ${args.template}`);
      console.log('Available templates:', templates.map(t => t.id).join(', '));
      process.exit(1);
    }
    title = title || template.title;
    prompt = prompt || template.prompt;
  }

  if (!prompt) {
    console.error('Error: Prompt is required');
    console.log('Usage: talos add <prompt>');
    console.log('   or: talos add --template <id>');
    process.exit(1);
  }

  const task = {
    id: randomUUID().slice(0, 8),
    title: title || prompt.slice(0, 50) + (prompt.length > 50 ? '...' : ''),
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
    console.log('─'.repeat(60));
    
    if (tasks.length === 0) {
      console.log('  (empty)');
    } else {
      for (const t of tasks) {
        const time = new Date(t.createdAt).toLocaleString();
        const duration = t.result?.durationMs ? ` (${(t.result.durationMs/1000).toFixed(1)}s)` : '';
        console.log(`  ${t.id}  ${t.title.slice(0, 30).padEnd(30)}  ${time}${duration}`);
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
      console.log('─'.repeat(60));
      console.log(`Title:   ${task.title}`);
      console.log(`Type:    ${task.type}`);
      console.log(`Created: ${new Date(task.createdAt).toLocaleString()}`);
      if (task.workingDir) console.log(`WorkDir: ${task.workingDir}`);
      console.log(`\nPrompt:\n${task.prompt}`);
      
      if (task.result) {
        console.log(`\nResult:`);
        console.log(`  Exit Code: ${task.result.exitCode}`);
        console.log(`  Mode:      ${task.result.mode || 'unknown'}`);
        console.log(`  Duration:  ${task.result.durationMs ? (task.result.durationMs / 1000).toFixed(1) + 's' : 'N/A'}`);
        
        if (task.result.output) {
          console.log(`\nOutput:\n${task.result.output}`);
        }
        if (task.result.error) {
          console.log(`\nError: ${task.result.error}`);
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
      delete task.output;
      delete task.startedAt;
      delete task.completedAt;
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
  
  if (args._[1] === 'get' && args._[2]) {
    const keys = args._[2].split('.');
    let value = config;
    for (const key of keys) {
      value = value?.[key];
    }
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  
  if (args._[1] === 'set' && args._[2] && args._[3] !== undefined) {
    const keys = args._[2].split('.');
    let value = args._[3];
    
    // Parse values
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (value === 'null') value = null;
    else if (!isNaN(value)) value = Number(value);
    else if (value.startsWith('[') || value.startsWith('{')) {
      try { value = JSON.parse(value); } catch {}
    }
    
    // Set nested value
    let obj = config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    
    saveConfig(config);
    console.log(`✓ Set ${args._[2]} = ${JSON.stringify(value)}`);
    return;
  }
  
  console.log('\nConfiguration:');
  console.log('─'.repeat(50));
  console.log(JSON.stringify(config, null, 2));
  console.log('');
}

function cmdTemplates() {
  const config = loadConfig();
  const templates = config.templates || [];
  
  console.log('\nAvailable Templates:');
  console.log('─'.repeat(50));
  
  if (templates.length === 0) {
    console.log('  No templates configured');
  } else {
    for (const t of templates) {
      console.log(`  ${t.icon || '📋'} ${t.id.padEnd(15)} ${t.title}`);
    }
  }
  console.log('');
}

function cmdStats() {
  const stats = {
    queue: readTasks('queue').length,
    running: readTasks('running').length,
    done: readTasks('done').length,
    failed: readTasks('failed').length
  };
  
  const doneTasks = readTasks('done');
  const totalDuration = doneTasks.reduce((sum, t) => sum + (t.result?.durationMs || 0), 0);
  const avgDuration = doneTasks.length > 0 ? totalDuration / doneTasks.length : 0;
  
  console.log('\nTask Statistics:');
  console.log('─'.repeat(40));
  console.log(`  Queue:    ${stats.queue}`);
  console.log(`  Running:  ${stats.running}`);
  console.log(`  Done:     ${stats.done}`);
  console.log(`  Failed:   ${stats.failed}`);
  console.log(`  Total:    ${stats.queue + stats.running + stats.done + stats.failed}`);
  console.log('');
  console.log(`  Success Rate: ${stats.done + stats.failed > 0 ? 
    ((stats.done / (stats.done + stats.failed)) * 100).toFixed(1) + '%' : 'N/A'}`);
  console.log(`  Avg Duration: ${avgDuration > 0 ? (avgDuration / 1000).toFixed(1) + 's' : 'N/A'}`);
  console.log('');
}

function cmdExport(args) {
  const taskId = args._[1];
  const outputFile = args._[2];
  
  if (!taskId) {
    console.error('Error: Task ID is required');
    console.log('Usage: talos export <id> [output.md]');
    process.exit(1);
  }

  for (const status of ['queue', 'running', 'done', 'failed']) {
    const tasks = readTasks(status);
    const task = tasks.find(t => t.id === taskId || t.id.startsWith(taskId));
    
    if (task) {
      const content = `# Task: ${task.title}

**ID:** ${task.id}
**Status:** ${status}
**Type:** ${task.type}
**Created:** ${new Date(task.createdAt).toISOString()}
${task.workingDir ? `**Working Dir:** ${task.workingDir}\n` : ''}
## Prompt

\`\`\`
${task.prompt}
\`\`\`

${task.result ? `## Result

**Exit Code:** ${task.result.exitCode}
**Duration:** ${task.result.durationMs ? (task.result.durationMs / 1000).toFixed(1) + 's' : 'N/A'}
**Mode:** ${task.result.mode || 'unknown'}
${task.result.error ? `**Error:** ${task.result.error}\n` : ''}
### Output

\`\`\`
${task.result.output || task.output || '(no output)'}
\`\`\`
` : ''}`;

      if (outputFile) {
        fs.writeFileSync(outputFile, content);
        console.log(`✓ Exported to: ${outputFile}`);
      } else {
        console.log(content);
      }
      return;
    }
  }
  
  console.error(`Task not found: ${taskId}`);
  process.exit(1);
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
  case 'templates':
    cmdTemplates();
    break;
  case 'stats':
    cmdStats();
    break;
  case 'export':
    cmdExport(args);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
