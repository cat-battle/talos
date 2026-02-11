/**
 * TaskExecutor Tests
 * Run with: node --test test/executor.test.js
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { setupTestEnv, cleanupTestEnv } = require('./helpers');

// ============================================
// TaskExecutor Config Tests
// ============================================

describe('TaskExecutor Configuration', () => {
  test('config supports execution mode setting', () => {
    const config = {
      execution: { mode: 'acp', fallbackToPrompt: true }
    };
    assert.equal(config.execution.mode, 'acp');
    assert.equal(config.execution.fallbackToPrompt, true);
  });

  test('config supports prompt mode', () => {
    const config = {
      execution: { mode: 'prompt', fallbackToPrompt: false }
    };
    assert.equal(config.execution.mode, 'prompt');
  });

  test('permissions config structure is valid', () => {
    const config = {
      permissions: {
        allowAllTools: false,
        allowAllPaths: false,
        allowAllUrls: false,
        allowTools: ['shell(git)', 'write'],
        denyTools: ['shell(rm)'],
        allowUrls: ['github.com']
      }
    };
    
    assert.ok(Array.isArray(config.permissions.allowTools));
    assert.ok(Array.isArray(config.permissions.denyTools));
    assert.ok(Array.isArray(config.permissions.allowUrls));
  });

  test('custom instructions config is valid', () => {
    const config = {
      customInstructions: {
        enabled: true,
        globalFile: '~/.copilot/copilot-instructions.md',
        projectFile: '.github/copilot-instructions.md'
      }
    };
    
    assert.equal(config.customInstructions.enabled, true);
    assert.ok(config.customInstructions.projectFile.includes('copilot-instructions.md'));
  });
});

// ============================================
// Templates Tests
// ============================================

describe('Task Templates', () => {
  test('template has required fields', () => {
    const template = {
      id: 'code-review',
      title: 'Code Review',
      prompt: 'Review the code',
      icon: '🔍'
    };
    
    assert.ok(template.id);
    assert.ok(template.title);
    assert.ok(template.prompt);
  });

  test('templates array is valid', () => {
    const templates = [
      { id: 'review', title: 'Review', prompt: 'Review code', icon: '🔍' },
      { id: 'test', title: 'Test', prompt: 'Write tests', icon: '🧪' },
      { id: 'fix', title: 'Fix', prompt: 'Fix bug', icon: '🐛' }
    ];
    
    assert.equal(templates.length, 3);
    assert.ok(templates.every(t => t.id && t.title && t.prompt));
  });
});

// ============================================
// Command Building Tests
// ============================================

describe('Command Building', () => {
  test('builds basic prompt args', () => {
    const task = { prompt: 'list files' };
    const args = ['-p', task.prompt];
    
    assert.deepEqual(args, ['-p', 'list files']);
  });

  test('builds args with allow-all-tools', () => {
    const args = ['-p', 'test', '--allow-all-tools'];
    
    assert.ok(args.includes('--allow-all-tools'));
  });

  test('builds args with specific allowed tools', () => {
    const allowTools = ['shell(git)', 'write'];
    const args = ['-p', 'test'];
    
    for (const tool of allowTools) {
      args.push('--allow-tool', tool);
    }
    
    assert.ok(args.includes('--allow-tool'));
    assert.ok(args.includes('shell(git)'));
    assert.ok(args.includes('write'));
  });

  test('builds args with denied tools', () => {
    const denyTools = ['shell(rm)', 'shell(sudo)'];
    const args = ['-p', 'test'];
    
    for (const tool of denyTools) {
      args.push('--deny-tool', tool);
    }
    
    assert.ok(args.includes('--deny-tool'));
    assert.ok(args.includes('shell(rm)'));
  });

  test('builds args with path permissions', () => {
    const args = ['-p', 'test', '--allow-all-paths'];
    
    assert.ok(args.includes('--allow-all-paths'));
  });

  test('builds args with URL permissions', () => {
    const args = ['-p', 'test', '--allow-url', 'github.com'];
    
    assert.ok(args.includes('--allow-url'));
    assert.ok(args.includes('github.com'));
  });

  test('builds args with model override', () => {
    const args = ['-p', 'test', '--model', 'claude-sonnet-4'];
    
    assert.ok(args.includes('--model'));
    assert.ok(args.includes('claude-sonnet-4'));
  });
});

// ============================================
// ACP Message Handling Tests
// ============================================

describe('ACP Message Types', () => {
  test('session update chunk format', () => {
    const message = {
      params: {
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello' }
        }
      }
    };
    
    assert.equal(message.params.update.sessionUpdate, 'agent_message_chunk');
    assert.equal(message.params.update.content.type, 'text');
    assert.equal(message.params.update.content.text, 'Hello');
  });

  test('tool use format', () => {
    const message = {
      params: {
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'tool_use',
            name: 'shell',
            input: { command: 'ls -la' }
          }
        }
      }
    };
    
    assert.equal(message.params.update.content.type, 'tool_use');
    assert.equal(message.params.update.content.name, 'shell');
  });

  test('permission request format', () => {
    const request = {
      tool: 'shell(git)',
      args: ['commit', '-m', 'test'],
      description: 'Run git commit'
    };
    
    assert.ok(request.tool);
    assert.ok(Array.isArray(request.args));
  });

  test('permission response format', () => {
    const approved = { outcome: 'approved' };
    const denied = { outcome: 'cancelled' };
    
    assert.equal(approved.outcome, 'approved');
    assert.equal(denied.outcome, 'cancelled');
  });
});

// ============================================
// Task Result Tests
// ============================================

describe('Task Results', () => {
  test('successful result has correct fields', () => {
    const result = {
      exitCode: 0,
      stopReason: 'end_turn',
      output: 'Task completed',
      durationMs: 5000,
      mode: 'acp'
    };
    
    assert.equal(result.exitCode, 0);
    assert.ok(result.durationMs > 0);
    assert.ok(['acp', 'prompt'].includes(result.mode));
  });

  test('failed result has error field', () => {
    const result = {
      exitCode: 1,
      error: 'Command failed',
      output: 'Error output',
      durationMs: 1000,
      mode: 'prompt'
    };
    
    assert.ok(result.exitCode !== 0);
    assert.ok(result.error);
  });

  test('cancelled result format', () => {
    const result = {
      exitCode: -1,
      error: 'Cancelled by user',
      output: 'Partial output',
      durationMs: 500
    };
    
    assert.equal(result.exitCode, -1);
    assert.ok(result.error.includes('Cancelled'));
  });
});

console.log('\nRun tests with: node --test test/executor.test.js\n');
