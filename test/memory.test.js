/**
 * Memory Manager Tests
 * Run with: node --test test/memory.test.js
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { MemoryManager } = require('../server/memory');

const TEST_MEMORY_DIR = path.join(__dirname, '.test-memory');

describe('MemoryManager', () => {
  let memory;

  before(() => {
    // Clean up any previous test data
    if (fs.existsSync(TEST_MEMORY_DIR)) {
      fs.rmSync(TEST_MEMORY_DIR, { recursive: true });
    }
    memory = new MemoryManager(TEST_MEMORY_DIR);
  });

  after(() => {
    // Cleanup
    if (fs.existsSync(TEST_MEMORY_DIR)) {
      fs.rmSync(TEST_MEMORY_DIR, { recursive: true });
    }
  });

  describe('Initialization', () => {
    test('creates memory directory structure', () => {
      assert.ok(fs.existsSync(TEST_MEMORY_DIR));
      assert.ok(fs.existsSync(path.join(TEST_MEMORY_DIR, 'projects')));
      assert.ok(fs.existsSync(path.join(TEST_MEMORY_DIR, 'patterns.json')));
      assert.ok(fs.existsSync(path.join(TEST_MEMORY_DIR, 'index.json')));
    });

    test('patterns.json has correct structure', () => {
      const patterns = JSON.parse(fs.readFileSync(
        path.join(TEST_MEMORY_DIR, 'patterns.json'), 'utf-8'
      ));
      assert.ok('toolApprovals' in patterns);
      assert.ok('averageDurations' in patterns);
      assert.ok('successPatterns' in patterns);
      assert.ok('failurePatterns' in patterns);
    });

    test('index.json has correct structure', () => {
      const index = JSON.parse(fs.readFileSync(
        path.join(TEST_MEMORY_DIR, 'index.json'), 'utf-8'
      ));
      assert.ok('projects' in index);
      assert.ok('keywords' in index);
    });
  });

  describe('Project Management', () => {
    test('creates project for working directory', () => {
      const project = memory.getProject('/test/project');
      assert.ok(project.id);
      assert.ok(project.dir);
      assert.ok(fs.existsSync(project.dir));
    });

    test('creates project files', () => {
      const project = memory.getProject('/test/project2');
      assert.ok(fs.existsSync(path.join(project.dir, 'meta.json')));
      assert.ok(fs.existsSync(path.join(project.dir, 'context.md')));
      assert.ok(fs.existsSync(path.join(project.dir, 'tasks.jsonl')));
    });

    test('returns same project for same path', () => {
      const p1 = memory.getProject('/same/path');
      const p2 = memory.getProject('/same/path');
      assert.equal(p1.id, p2.id);
    });

    test('handles null/undefined working directory', () => {
      const project = memory.getProject(null);
      assert.ok(project.id);
    });
  });

  describe('Task Recording', () => {
    test('records completed task', () => {
      const task = {
        id: 'task123',
        title: 'Test Task',
        prompt: 'Do something useful',
        type: 'shell',
        workingDir: '/test/recording'
      };
      const result = {
        exitCode: 0,
        durationMs: 5000,
        mode: 'acp',
        output: 'Created new file\nUpdated config'
      };

      const record = memory.recordTask(task, result);
      
      assert.equal(record.id, 'task123');
      assert.equal(record.success, true);
      assert.equal(record.durationMs, 5000);
    });

    test('retrieves recent tasks', () => {
      const tasks = memory.getRecentTasks('/test/recording', 10);
      assert.ok(Array.isArray(tasks));
      assert.ok(tasks.length > 0);
      assert.equal(tasks[0].id, 'task123');
    });

    test('records failed task', () => {
      const task = {
        id: 'failedtask',
        title: 'Failed Task',
        prompt: 'This will fail',
        type: 'shell',
        workingDir: '/test/recording'
      };
      const result = {
        exitCode: 1,
        durationMs: 1000,
        mode: 'prompt',
        error: 'Command not found'
      };

      const record = memory.recordTask(task, result);
      assert.equal(record.success, false);
      assert.equal(record.error, 'Command not found');
    });
  });

  describe('Pattern Learning', () => {
    test('updates duration averages', () => {
      const patterns = memory.getPatterns();
      assert.ok(patterns.averageDurations.shell);
      assert.ok(patterns.averageDurations.shell.count > 0);
    });

    test('records tool approval', () => {
      memory.recordToolDecision('shell(git)', true);
      memory.recordToolDecision('shell(git)', true);
      
      const patterns = memory.getPatterns();
      assert.ok(patterns.toolApprovals['shell(git)']);
      assert.equal(patterns.toolApprovals['shell(git)'].approved, 2);
    });

    test('records tool denial', () => {
      memory.recordToolDecision('shell(rm)', false);
      
      const patterns = memory.getPatterns();
      assert.equal(patterns.toolApprovals['shell(rm)'].denied, 1);
    });

    test('auto-approves after 5 consecutive approvals', () => {
      for (let i = 0; i < 5; i++) {
        memory.recordToolDecision('shell(npm)', true);
      }
      
      assert.equal(memory.shouldAutoApprove('shell(npm)'), true);
    });

    test('does not auto-approve if denied', () => {
      memory.recordToolDecision('shell(sudo)', true);
      memory.recordToolDecision('shell(sudo)', false);
      
      assert.equal(memory.shouldAutoApprove('shell(sudo)'), false);
    });
  });

  describe('Context Retrieval', () => {
    test('gets context for task', () => {
      const task = {
        prompt: 'Create a new file',
        workingDir: '/test/recording'
      };
      
      const context = memory.getContextForTask(task);
      
      assert.ok('projectContext' in context);
      assert.ok('recentTasks' in context);
      assert.ok('relevantPatterns' in context);
      assert.ok('suggestedApprovals' in context);
    });

    test('builds context prompt', () => {
      const task = {
        prompt: 'Do something',
        workingDir: '/test/recording'
      };
      
      const prompt = memory.buildContextPrompt(task);
      assert.equal(typeof prompt, 'string');
    });
  });

  describe('Learnings', () => {
    test('adds learning to project context', () => {
      memory.addLearning('/test/learnings', 'Use pnpm instead of npm');
      
      const project = memory.getProject('/test/learnings');
      assert.ok(project.context.includes('pnpm'));
    });

    test('extracts learnings from successful result', () => {
      const task = { prompt: 'fix bug' };
      const result = {
        exitCode: 0,
        output: 'Fixed the authentication bug\nUpdated tests'
      };
      
      const learnings = memory.extractLearnings(task, result);
      assert.ok(Array.isArray(learnings));
    });
  });

  describe('Search', () => {
    test('searches across tasks', () => {
      const results = memory.search('file');
      assert.ok(Array.isArray(results));
    });

    test('returns scored results', () => {
      // Record a task with specific keywords
      memory.recordTask({
        id: 'searchtest',
        title: 'Docker Container Test',
        prompt: 'List all docker containers and images',
        workingDir: '/test/search'
      }, { exitCode: 0, durationMs: 100, output: 'done' });
      
      const results = memory.search('docker containers');
      assert.ok(results.some(r => r.taskId === 'searchtest'));
    });
  });

  describe('Stats', () => {
    test('returns memory stats', () => {
      const stats = memory.getStats();
      
      assert.ok('projects' in stats);
      assert.ok('totalTasks' in stats);
      assert.ok('indexedKeywords' in stats);
      assert.ok('autoApprovedTools' in stats);
      assert.ok(stats.projects > 0);
    });
  });
});

console.log('\nRun tests with: node --test test/memory.test.js\n');
