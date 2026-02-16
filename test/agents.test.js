/**
 * Agent Abstraction Tests
 * Run with: node --test test/agents.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  BaseAgent,
  CopilotAgent,
  ClaudeCodeAgent,
  getAgentIds,
  getAgentClass,
  createAgent,
  getAgentInfo
} = require('../server/agents');

describe('Agent Registry', () => {
  test('getAgentIds returns all agent IDs', () => {
    const ids = getAgentIds();
    assert.ok(ids.includes('copilot'));
    assert.ok(ids.includes('claude-code'));
  });

  test('getAgentClass returns correct class', () => {
    assert.strictEqual(getAgentClass('copilot'), CopilotAgent);
    assert.strictEqual(getAgentClass('claude-code'), ClaudeCodeAgent);
    assert.strictEqual(getAgentClass('unknown'), null);
  });

  test('createAgent creates correct instance', () => {
    const copilot = createAgent('copilot', {});
    assert.ok(copilot instanceof CopilotAgent);
    assert.ok(copilot instanceof BaseAgent);

    const claude = createAgent('claude-code', {});
    assert.ok(claude instanceof ClaudeCodeAgent);
    assert.ok(claude instanceof BaseAgent);
  });

  test('createAgent throws for unknown agent', () => {
    assert.throws(() => createAgent('unknown'), /Unknown agent/);
  });

  test('getAgentInfo returns agent metadata', () => {
    const info = getAgentInfo('copilot');
    assert.strictEqual(info.id, 'copilot');
    assert.strictEqual(info.name, 'GitHub Copilot CLI');
    assert.ok(info.capabilities);
  });
});

describe('CopilotAgent', () => {
  test('has correct static properties', () => {
    assert.strictEqual(CopilotAgent.id, 'copilot');
    assert.strictEqual(CopilotAgent.name, 'GitHub Copilot CLI');
  });

  test('has expected capabilities', () => {
    const caps = CopilotAgent.capabilities;
    assert.strictEqual(caps.streaming, true);
    assert.strictEqual(caps.interactive, true);
    assert.ok(caps.tools.includes('shell'));
    assert.ok(caps.tools.includes('write'));
  });

  test('buildArgs creates correct arguments', () => {
    const agent = new CopilotAgent({
      permissions: {
        allowAllTools: true
      },
      model: 'claude-sonnet-4'
    });

    const args = agent.buildArgs({ prompt: 'test' });
    assert.ok(args.includes('-p'));
    assert.ok(args.includes('test'));
    assert.ok(args.includes('--allow-all-tools'));
    assert.ok(args.includes('--model'));
    assert.ok(args.includes('claude-sonnet-4'));
  });

  test('buildArgs handles tool permissions', () => {
    const agent = new CopilotAgent({
      permissions: {
        allowTools: ['shell(git)', 'write'],
        denyTools: ['shell(rm)']
      }
    });

    const args = agent.buildArgs({ prompt: 'test' });
    assert.ok(args.includes('--allow-tool'));
    assert.ok(args.includes('shell(git)'));
    assert.ok(args.includes('--deny-tool'));
    assert.ok(args.includes('shell(rm)'));
  });
});

describe('ClaudeCodeAgent', () => {
  test('has correct static properties', () => {
    assert.strictEqual(ClaudeCodeAgent.id, 'claude-code');
    assert.strictEqual(ClaudeCodeAgent.name, 'Claude Code');
  });

  test('has expected capabilities', () => {
    const caps = ClaudeCodeAgent.capabilities;
    assert.strictEqual(caps.streaming, true);
    assert.ok(caps.tools.includes('shell'));
    assert.ok(caps.tools.includes('edit'));
    assert.ok(caps.tools.includes('web_search'));
  });

  test('buildArgs creates correct arguments', () => {
    const agent = new ClaudeCodeAgent({
      model: 'claude-sonnet-4',
      maxTurns: 5
    });

    const args = agent.buildArgs({ prompt: 'test' });
    assert.ok(args.includes('-p'));
    assert.ok(args.includes('test'));
    assert.ok(args.includes('--model'));
    assert.ok(args.includes('--max-turns'));
    assert.ok(args.includes('5'));
  });

  test('buildArgs handles tool permissions', () => {
    const agent = new ClaudeCodeAgent({
      permissions: {
        allowTools: ['shell', 'write'],
        denyTools: ['web_fetch']
      }
    });

    const args = agent.buildArgs({ prompt: 'test' });
    assert.ok(args.includes('--allowedTools'));
    assert.ok(args.includes('shell'));
    assert.ok(args.includes('--disallowedTools'));
    assert.ok(args.includes('web_fetch'));
  });
});

describe('BaseAgent', () => {
  test('is an EventEmitter', () => {
    const agent = new CopilotAgent({});
    assert.ok(typeof agent.on === 'function');
    assert.ok(typeof agent.emit === 'function');
  });

  test('info() emits info event', (t, done) => {
    const agent = new CopilotAgent({});
    agent.on('info', (data) => {
      assert.strictEqual(data.message, 'test message');
      done();
    });
    agent.info('test message');
  });
});

console.log('\nRun tests with: node --test test/agents.test.js\n');
