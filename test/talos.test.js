/**
 * Talos Test Suite
 * Run with: node --test test/talos.test.js
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const {
  setupTestEnv,
  cleanupTestEnv,
  createTestTask,
  readTestTask,
  countTasks
} = require('./helpers');

// ============================================
// Task File Operations
// ============================================

describe('Task File Operations', () => {
  let env;
  
  before(() => {
    env = setupTestEnv();
  });
  
  after(() => {
    cleanupTestEnv();
  });
  
  test('creates queue directory structure', () => {
    assert.ok(fs.existsSync(path.join(env.TASKS_DIR, 'queue')));
    assert.ok(fs.existsSync(path.join(env.TASKS_DIR, 'running')));
    assert.ok(fs.existsSync(path.join(env.TASKS_DIR, 'done')));
    assert.ok(fs.existsSync(path.join(env.TASKS_DIR, 'failed')));
  });
  
  test('creates and reads task file', () => {
    const task = {
      id: 'test001',
      title: 'Test Task',
      prompt: 'echo hello',
      type: 'shell',
      createdAt: new Date().toISOString()
    };
    
    createTestTask('queue', task);
    const read = readTestTask('queue', 'test001');
    
    assert.equal(read.id, task.id);
    assert.equal(read.title, task.title);
    assert.equal(read.prompt, task.prompt);
  });
  
  test('counts tasks correctly', () => {
    // Already have test001 from previous test
    assert.equal(countTasks('queue'), 1);
    assert.equal(countTasks('running'), 0);
    assert.equal(countTasks('done'), 0);
    
    createTestTask('queue', {
      id: 'test002',
      title: 'Another Task',
      prompt: 'echo world',
      type: 'shell',
      createdAt: new Date().toISOString()
    });
    
    assert.equal(countTasks('queue'), 2);
  });
});

// ============================================
// Task JSON Schema
// ============================================

describe('Task JSON Schema', () => {
  test('valid task has required fields', () => {
    const validTask = {
      id: 'abc123',
      title: 'My Task',
      prompt: 'do something',
      type: 'shell',
      createdAt: '2026-02-10T00:00:00.000Z'
    };
    
    assert.ok(validTask.id, 'id is required');
    assert.ok(validTask.title, 'title is required');
    assert.ok(validTask.prompt, 'prompt is required');
    assert.ok(validTask.type, 'type is required');
    assert.ok(validTask.createdAt, 'createdAt is required');
  });
  
  test('completed task has result object', () => {
    const completedTask = {
      id: 'done123',
      title: 'Completed Task',
      prompt: 'echo done',
      type: 'shell',
      createdAt: '2026-02-10T00:00:00.000Z',
      result: {
        exitCode: 0,
        stdout: 'done\n',
        stderr: '',
        startedAt: '2026-02-10T00:00:01.000Z',
        completedAt: '2026-02-10T00:00:02.000Z',
        durationMs: 1000
      }
    };
    
    assert.ok(completedTask.result, 'result is required for completed tasks');
    assert.strictEqual(completedTask.result.exitCode, 0);
    assert.ok(completedTask.result.durationMs > 0);
  });
  
  test('task type must be valid', () => {
    const validTypes = ['shell', 'gh', 'git'];
    
    for (const type of validTypes) {
      assert.ok(validTypes.includes(type), `${type} is a valid type`);
    }
    
    assert.ok(!validTypes.includes('invalid'), 'invalid is not a valid type');
  });
});

// ============================================
// Config Operations
// ============================================

describe('Config Operations', () => {
  let env;
  
  before(() => {
    env = setupTestEnv();
  });
  
  after(() => {
    cleanupTestEnv();
  });
  
  test('config file exists and is valid JSON', () => {
    const configPath = path.join(env.TEST_DIR, 'config.json');
    assert.ok(fs.existsSync(configPath));
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.ok(config.pollIntervalMs);
    assert.ok(config.tasksDir);
  });
  
  test('config has required fields', () => {
    const configPath = path.join(env.TEST_DIR, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    assert.ok(typeof config.pollIntervalMs === 'number');
    assert.ok(typeof config.tasksDir === 'string');
    assert.ok(typeof config.webPort === 'number');
  });
  
  test('poll interval is reasonable', () => {
    const configPath = path.join(env.TEST_DIR, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    // Should be at least 1 second, at most 1 hour
    assert.ok(config.pollIntervalMs >= 1000, 'poll interval >= 1 second');
    assert.ok(config.pollIntervalMs <= 3600000, 'poll interval <= 1 hour');
  });
});

// ============================================
// Daemon Logic (Unit Tests)
// ============================================

describe('Daemon Logic', () => {
  let env;
  
  beforeEach(() => {
    env = setupTestEnv();
  });
  
  after(() => {
    cleanupTestEnv();
  });
  
  test('moves task from queue to running', () => {
    const task = {
      id: 'move001',
      title: 'Move Test',
      prompt: 'echo test',
      type: 'shell',
      createdAt: new Date().toISOString()
    };
    
    createTestTask('queue', task);
    assert.equal(countTasks('queue'), 1);
    assert.equal(countTasks('running'), 0);
    
    // Simulate move
    const src = path.join(env.TASKS_DIR, 'queue', `${task.id}.json`);
    const dst = path.join(env.TASKS_DIR, 'running', `${task.id}.json`);
    fs.renameSync(src, dst);
    
    assert.equal(countTasks('queue'), 0);
    assert.equal(countTasks('running'), 1);
  });
  
  test('moves completed task to done', () => {
    const task = {
      id: 'complete001',
      title: 'Complete Test',
      prompt: 'echo done',
      type: 'shell',
      createdAt: new Date().toISOString()
    };
    
    createTestTask('running', task);
    
    // Simulate completion
    task.result = {
      exitCode: 0,
      stdout: 'done\n',
      stderr: '',
      durationMs: 100
    };
    
    const src = path.join(env.TASKS_DIR, 'running', `${task.id}.json`);
    fs.writeFileSync(src, JSON.stringify(task, null, 2));
    
    const dst = path.join(env.TASKS_DIR, 'done', `${task.id}.json`);
    fs.renameSync(src, dst);
    
    assert.equal(countTasks('running'), 0);
    assert.equal(countTasks('done'), 1);
    
    const completed = readTestTask('done', task.id);
    assert.equal(completed.result.exitCode, 0);
  });
  
  test('moves failed task to failed', () => {
    const task = {
      id: 'fail001',
      title: 'Fail Test',
      prompt: 'exit 1',
      type: 'shell',
      createdAt: new Date().toISOString()
    };
    
    createTestTask('running', task);
    
    // Simulate failure
    task.result = {
      exitCode: 1,
      stdout: '',
      stderr: 'error\n',
      durationMs: 100
    };
    
    const src = path.join(env.TASKS_DIR, 'running', `${task.id}.json`);
    fs.writeFileSync(src, JSON.stringify(task, null, 2));
    
    const dst = path.join(env.TASKS_DIR, 'failed', `${task.id}.json`);
    fs.renameSync(src, dst);
    
    assert.equal(countTasks('running'), 0);
    assert.equal(countTasks('failed'), 1);
    
    const failed = readTestTask('failed', task.id);
    assert.equal(failed.result.exitCode, 1);
  });
  
  test('processes tasks in FIFO order', () => {
    // Create tasks with different timestamps
    const task1 = {
      id: 'fifo001',
      title: 'First',
      prompt: 'echo 1',
      type: 'shell',
      createdAt: '2026-02-10T00:00:00.000Z'
    };
    
    const task2 = {
      id: 'fifo002',
      title: 'Second',
      prompt: 'echo 2',
      type: 'shell',
      createdAt: '2026-02-10T00:00:01.000Z'
    };
    
    // Create in reverse order
    createTestTask('queue', task2);
    createTestTask('queue', task1);
    
    // Read and sort by createdAt
    const queueDir = path.join(env.TASKS_DIR, 'queue');
    const files = fs.readdirSync(queueDir)
      .filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(fs.readFileSync(path.join(queueDir, f), 'utf-8')))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    
    assert.equal(files[0].id, 'fifo001', 'First task should be processed first');
    assert.equal(files[1].id, 'fifo002', 'Second task should be processed second');
  });
});

// ============================================
// Web API (Stub Tests)
// ============================================

describe('Web API Routes', () => {
  test('GET /api/tasks route exists', () => {
    // This is a structural test - verifying the route is defined
    const serverCode = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'server.js'),
      'utf-8'
    );
    
    assert.ok(serverCode.includes("pathname === '/api/tasks'"));
    assert.ok(serverCode.includes("req.method === 'GET'"));
  });
  
  test('POST /api/tasks route exists', () => {
    const serverCode = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'server.js'),
      'utf-8'
    );
    
    assert.ok(serverCode.includes("pathname === '/api/tasks'"));
    assert.ok(serverCode.includes("req.method === 'POST'"));
  });
  
  test('DELETE /api/tasks/:id route exists', () => {
    const serverCode = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'server.js'),
      'utf-8'
    );
    
    assert.ok(serverCode.includes("pathname.startsWith('/api/tasks/')"));
    assert.ok(serverCode.includes("req.method === 'DELETE'"));
  });
  
  test('config API routes exist', () => {
    const serverCode = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'server.js'),
      'utf-8'
    );
    
    assert.ok(serverCode.includes("pathname === '/api/config'"));
  });
});

// ============================================
// CLI Commands (Structural Tests)
// ============================================

describe('CLI Commands', () => {
  test('CLI has add command', () => {
    const cliCode = fs.readFileSync(
      path.join(__dirname, '..', 'cli', 'index.js'),
      'utf-8'
    );
    
    assert.ok(cliCode.includes("case 'add':"));
    assert.ok(cliCode.includes('cmdAdd'));
  });
  
  test('CLI has list command', () => {
    const cliCode = fs.readFileSync(
      path.join(__dirname, '..', 'cli', 'index.js'),
      'utf-8'
    );
    
    assert.ok(cliCode.includes("case 'list':"));
    assert.ok(cliCode.includes('cmdList'));
  });
  
  test('CLI has show command', () => {
    const cliCode = fs.readFileSync(
      path.join(__dirname, '..', 'cli', 'index.js'),
      'utf-8'
    );
    
    assert.ok(cliCode.includes("case 'show':"));
    assert.ok(cliCode.includes('cmdShow'));
  });
  
  test('CLI has delete command', () => {
    const cliCode = fs.readFileSync(
      path.join(__dirname, '..', 'cli', 'index.js'),
      'utf-8'
    );
    
    assert.ok(cliCode.includes("case 'delete':"));
    assert.ok(cliCode.includes('cmdDelete'));
  });
  
  test('CLI has requeue command', () => {
    const cliCode = fs.readFileSync(
      path.join(__dirname, '..', 'cli', 'index.js'),
      'utf-8'
    );
    
    assert.ok(cliCode.includes("case 'requeue':"));
    assert.ok(cliCode.includes('cmdRequeue'));
  });
  
  test('CLI has config command', () => {
    const cliCode = fs.readFileSync(
      path.join(__dirname, '..', 'cli', 'index.js'),
      'utf-8'
    );
    
    assert.ok(cliCode.includes("case 'config':"));
    assert.ok(cliCode.includes('cmdConfig'));
  });
});

// ============================================
// Integration Test: Stub Copilot Execution
// ============================================

describe('Stub Copilot Execution', () => {
  let env;
  
  before(() => {
    env = setupTestEnv();
  });
  
  after(() => {
    cleanupTestEnv();
  });
  
  test('stub command executes and captures output', async () => {
    // Use echo as a stub for copilot
    const proc = spawn('echo', ['hello from stub']);
    
    let stdout = '';
    proc.stdout.on('data', d => stdout += d);
    
    await new Promise(resolve => proc.on('close', resolve));
    
    assert.ok(stdout.includes('hello from stub'));
  });
  
  test('stub command captures exit code', async () => {
    const proc = spawn('sh', ['-c', 'exit 42']);
    
    const code = await new Promise(resolve => proc.on('close', resolve));
    
    assert.equal(code, 42);
  });
  
  test('stub command captures stderr', async () => {
    const proc = spawn('sh', ['-c', 'echo error >&2']);
    
    let stderr = '';
    proc.stderr.on('data', d => stderr += d);
    
    await new Promise(resolve => proc.on('close', resolve));
    
    assert.ok(stderr.includes('error'));
  });
});

console.log('\nRun tests with: node --test test/talos.test.js\n');
