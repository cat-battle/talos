#!/usr/bin/env node
/**
 * Talos Daemon
 * Polls task queue and executes GitHub Copilot CLI
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

  // Build command
  const args = ['copilot', 'suggest', '-t', task.type || 'shell', task.prompt];
  if (config.yoloMode) {
    // Note: --yolo flag may vary by copilot CLI version
    // Adjust as needed for your installation
  }

  return new Promise((resolve) => {
    const startTime = Date.now();
    const proc = spawn('gh', args, {
      cwd: task.workingDir || process.cwd(),
      env: { ...process.env },
      shell: true
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
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
        durationMs: endTime - startTime
      };

      // Write updated task
      fs.writeFileSync(runningPath, JSON.stringify(task, null, 2));

      // Move to done or failed
      const destDir = code === 0 ? doneDir : failedDir;
      const finalPath = moveTask(runningPath, destDir);
      
      console.log(`[${new Date().toISOString()}] Task ${task.id} ${code === 0 ? 'completed' : 'failed'} (exit ${code})`);
      resolve({ task, exitCode: code, finalPath });
    });

    proc.on('error', (err) => {
      task.result = {
        exitCode: -1,
        stdout: '',
        stderr: err.message,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        error: err.message
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
  console.log('='.repeat(50));
  console.log('  Talos Daemon Starting');
  console.log('='.repeat(50));
  
  let config = loadConfig();
  console.log(`Poll interval: ${config.pollIntervalMs / 1000}s`);
  console.log(`Tasks directory: ${path.resolve(path.dirname(CONFIG_PATH), config.tasksDir)}`);
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
