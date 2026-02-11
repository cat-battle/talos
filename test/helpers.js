/**
 * Test helpers and stubs
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TEST_DIR = path.join(__dirname, 'tmp');
const TASKS_DIR = path.join(TEST_DIR, 'tasks');

// Setup clean test environment
function setupTestEnv() {
  // Clean up if exists
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
  
  // Create fresh directories
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(path.join(TASKS_DIR, 'queue'), { recursive: true });
  fs.mkdirSync(path.join(TASKS_DIR, 'running'), { recursive: true });
  fs.mkdirSync(path.join(TASKS_DIR, 'done'), { recursive: true });
  fs.mkdirSync(path.join(TASKS_DIR, 'failed'), { recursive: true });
  
  // Create test config
  const config = {
    pollIntervalMs: 1000,
    tasksDir: TASKS_DIR,
    webPort: 3999,
    copilotCommand: 'echo',  // Stub: just echo the prompt
    allowAllTools: true,
    allowTools: [],
    denyTools: [],
    model: null
  };
  
  fs.writeFileSync(
    path.join(TEST_DIR, 'config.json'),
    JSON.stringify(config, null, 2)
  );
  
  return { TEST_DIR, TASKS_DIR, config };
}

// Cleanup test environment
function cleanupTestEnv() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

// Create a test task file
function createTestTask(status, task) {
  const filename = `${task.id}.json`;
  const filepath = path.join(TASKS_DIR, status, filename);
  fs.writeFileSync(filepath, JSON.stringify(task, null, 2));
  return filepath;
}

// Read task from directory
function readTestTask(status, taskId) {
  const dir = path.join(TASKS_DIR, status);
  const files = fs.readdirSync(dir).filter(f => f.startsWith(taskId));
  if (files.length === 0) return null;
  return JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8'));
}

// Count tasks in a status directory
function countTasks(status) {
  const dir = path.join(TASKS_DIR, status);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
}

// Run CLI command and capture output
function runCLI(args, cwd = TEST_DIR) {
  return new Promise((resolve) => {
    const cliPath = path.join(__dirname, '..', 'cli', 'index.js');
    const proc = spawn('node', [cliPath, ...args], {
      cwd,
      env: { ...process.env, TALOS_CONFIG: path.join(TEST_DIR, 'config.json') }
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    
    proc.on('close', code => {
      resolve({ code, stdout, stderr });
    });
  });
}

// Make HTTP request to web server
async function httpRequest(method, path, body = null, port = 3999) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    
    const options = {
      hostname: 'localhost',
      port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    
    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Wait for condition with timeout
async function waitFor(conditionFn, timeoutMs = 5000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await conditionFn()) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

module.exports = {
  setupTestEnv,
  cleanupTestEnv,
  createTestTask,
  readTestTask,
  countTasks,
  runCLI,
  httpRequest,
  waitFor,
  TEST_DIR,
  TASKS_DIR
};
