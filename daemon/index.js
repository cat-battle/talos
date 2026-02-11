#!/usr/bin/env node
/**
 * Talos Daemon
 * Polls task queue and executes GitHub Copilot CLI (new agent-based CLI)
 * 
 * Copilot CLI docs: https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

function ensureDirs(tasksDir) {
  const dirs = ['queue', 'running', 'done', 'failed'];
  for (const dir of dirs) {
    const p = path.join(tasksDir, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
}

function getQueuedTasks(tasksDir) {
  const queueDir = path.join(tasksDir, 'queue');
  if (!fs.existsSync(queueDir)) return [];
  
  return fs.readdirSync(queueDir)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(queueDir, f))
    .sort((a, b) => {
      // Sort by creation time (oldest first)
      return fs.statSync(a).ctimeMs - fs.statSync(b).ctimeMs;
    });
}

function moveTask(taskPath, toDir) {
  const filename = path.basename(taskPath);
  const newPath = path.join(toDir, filename);
  fs.renameSync(taskPath, newPath);
  return newPath;
}

/**
 * Build copilot CLI arguments based on task and config
 * 
 * New Copilot CLI programmatic mode:
 *   copilot -p "prompt" [options]
 * 
 * Options:
 *   --allow-all-tools     Allow all tools without approval
 *   --allow-tool 'X'      Allow specific tool (e.g., 'shell(git)', 'write')
 *   --deny-tool 'X'       Deny specific tool
 *   --model MODEL         Specify model (default: Claude Sonnet 4.5)
 */
function buildCopilotArgs(task, config) {
  const args = ['-p', task.prompt];
  
  // Tool approval mode
  if (config.allowAllTools) {
    args.push('--allow-all-tools');
  } else if (config.allowTools && config.allowTools.length > 0) {
    for (const tool of config.allowTools) {
      args.push('--allow-tool', tool);
    }
  }
  
  // Denied tools
  if (config.denyTools && config.denyTools.length > 0) {
    for (const tool of config.denyTools) {
      args.push('--deny-tool', tool);
    }
  }
  
  // Model selection
  if (config.model) {
    args.push('--model', config.model);
  }
  
  return args;
}

async function executeTask(taskPath, config) {
  const tasksDir = path.resolve(path.dirname(CONFIG_PATH), config.tasksDir);
  const runningDir = path.join(tasksDir, 'running');
  const doneDir = path.join(tasksDir, 'done');
  const failedDir = path.join(tasksDir, 'failed');

  // Move to running
  const runningPath = moveTask(taskPath, runningDir);
  
  // Load task
  const task = JSON.parse(fs.readFileSync(runningPath, 'utf-8'));
  console.log(`[${new Date().toISOString()}] Running task: ${task.id} - ${task.title}`);

  // Build command args for new Copilot CLI
  const args = buildCopilotArgs(task, config);
  const command = config.copilotCommand || 'copilot';
  
  console.log(`[${new Date().toISOString()}] Executing: ${command} ${args.join(' ')}`);

  return new Promise((resolve) => {
    const startTime = Date.now();
    const proc = spawn(command, args, {
      cwd: task.workingDir || process.cwd(),
      env: { ...process.env },
      shell: false
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      // Stream output in real-time
      process.stdout.write(data);
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    proc.on('close', (code) => {
      const endTime = Date.now();
      
      // Update task with results
      task.result = {
        exitCode: code,
        stdout: stdout,
        stderr: stderr,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date(endTime).toISOString(),
        durationMs: endTime - startTime,
        command: command,
        args: args
      };

      // Write updated task
      fs.writeFileSync(runningPath, JSON.stringify(task, null, 2));

      // Move to done or failed
      const destDir = code === 0 ? doneDir : failedDir;
      const finalPath = moveTask(runningPath, destDir);
      
      console.log(`\n[${new Date().toISOString()}] Task ${task.id} ${code === 0 ? 'completed' : 'failed'} (exit ${code})`);
      resolve({ task, exitCode: code, finalPath });
    });

    proc.on('error', (err) => {
      task.result = {
        exitCode: -1,
        stdout: '',
        stderr: err.message,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        error: err.message,
        command: command,
        args: args
      };
      
      fs.writeFileSync(runningPath, JSON.stringify(task, null, 2));
      const finalPath = moveTask(runningPath, failedDir);
      
      console.log(`[${new Date().toISOString()}] Task ${task.id} error: ${err.message}`);
      resolve({ task, exitCode: -1, finalPath });
    });
  });
}

async function pollOnce(config) {
  const tasksDir = path.resolve(path.dirname(CONFIG_PATH), config.tasksDir);
  ensureDirs(tasksDir);
  
  const tasks = getQueuedTasks(tasksDir);
  
  if (tasks.length === 0) {
    return;
  }

  console.log(`[${new Date().toISOString()}] Found ${tasks.length} task(s) in queue`);
  
  // Process one task at a time
  for (const taskPath of tasks) {
    await executeTask(taskPath, config);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('  Talos Daemon - GitHub Copilot CLI Task Queue');
  console.log('='.repeat(60));
  
  let config = loadConfig();
  console.log(`Poll interval: ${config.pollIntervalMs / 1000}s (${config.pollIntervalMs / 60000} min)`);
  console.log(`Tasks directory: ${path.resolve(path.dirname(CONFIG_PATH), config.tasksDir)}`);
  console.log(`Copilot command: ${config.copilotCommand || 'copilot'}`);
  console.log(`Allow all tools: ${config.allowAllTools || false}`);
  if (config.allowTools) console.log(`Allowed tools: ${config.allowTools.join(', ')}`);
  if (config.denyTools) console.log(`Denied tools: ${config.denyTools.join(', ')}`);
  console.log('');

  // Initial poll
  await pollOnce(config);

  // Set up interval
  setInterval(async () => {
    // Reload config each poll (allows live updates)
    try {
      config = loadConfig();
    } catch (e) {
      console.error('Failed to reload config:', e.message);
    }
    await pollOnce(config);
  }, config.pollIntervalMs);

  console.log(`[${new Date().toISOString()}] Daemon running. Waiting for tasks...`);
}

main().catch(console.error);
