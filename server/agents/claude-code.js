/**
 * Claude Code Agent Adapter
 * 
 * Adapter for Anthropic's Claude Code CLI.
 * Supports both interactive PTY mode and print mode (-p).
 */

const { spawn, execSync } = require('child_process');
const { BaseAgent } = require('./base');

class ClaudeCodeAgent extends BaseAgent {
  constructor(config = {}) {
    super(config);
    this.process = null;
    this.output = '';
    this.startTime = null;
  }

  static get id() {
    return 'claude-code';
  }

  static get name() {
    return 'Claude Code';
  }

  static get capabilities() {
    return {
      streaming: true,
      interactive: true,
      sessionResume: true,
      planMode: false,
      tools: ['shell', 'write', 'read', 'edit', 'glob', 'grep', 'web_search', 'web_fetch']
    };
  }

  static async isAvailable() {
    try {
      execSync('which claude', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  static async getVersion() {
    try {
      const version = execSync('claude --version', { encoding: 'utf-8' }).trim();
      return version;
    } catch {
      return 'unknown';
    }
  }

  async execute(task, options = {}) {
    this.running = true;
    this.output = '';
    this.startTime = Date.now();

    this.emit('started', { task });

    const mode = this.config.execution?.mode || 'print';

    try {
      if (mode === 'dangerously-skip-permissions') {
        return await this._executeSkipPermissions(task);
      } else {
        return await this._executePrint(task);
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Execute using print mode (-p flag)
   * Non-interactive, outputs result and exits
   */
  async _executePrint(task) {
    const workDir = task.workingDir || process.cwd();
    const command = this.config.claudeCommand || 'claude';
    const args = this.buildArgs(task);

    this.info(`Executing: ${command} ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      this.process = spawn(command, args, {
        cwd: workDir,
        env: { ...process.env },
        shell: false
      });

      this.process.stdout.on('data', (data) => {
        const text = data.toString();
        this.output += text;
        this.emit('chunk', { text });
      });

      this.process.stderr.on('data', (data) => {
        const text = data.toString();
        this.output += text;
        this.emit('stderr', { text });
      });

      this.process.on('error', (err) => {
        const result = {
          exitCode: -1,
          output: this.output,
          error: err.message,
          durationMs: Date.now() - this.startTime,
          agent: ClaudeCodeAgent.id
        };
        this.emit('failed', { error: err.message });
        reject(err);
      });

      this.process.on('close', (code) => {
        const result = {
          exitCode: code,
          output: this.output,
          durationMs: Date.now() - this.startTime,
          agent: ClaudeCodeAgent.id
        };

        if (code === 0) {
          this.emit('completed', { result });
          resolve(result);
        } else {
          result.error = `Process exited with code ${code}`;
          this.emit('failed', { error: result.error });
          reject(new Error(result.error));
        }
      });
    });
  }

  /**
   * Execute with --dangerously-skip-permissions flag
   * Skips all permission prompts (use with caution)
   */
  async _executeSkipPermissions(task) {
    const workDir = task.workingDir || process.cwd();
    const command = this.config.claudeCommand || 'claude';
    const args = [...this.buildArgs(task), '--dangerously-skip-permissions'];

    this.info(`Executing (skip permissions): ${command} ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      this.process = spawn(command, args, {
        cwd: workDir,
        env: { ...process.env },
        shell: false
      });

      this.process.stdout.on('data', (data) => {
        const text = data.toString();
        this.output += text;
        this.emit('chunk', { text });
      });

      this.process.stderr.on('data', (data) => {
        const text = data.toString();
        this.output += text;
        this.emit('stderr', { text });
      });

      this.process.on('error', (err) => {
        const result = {
          exitCode: -1,
          output: this.output,
          error: err.message,
          durationMs: Date.now() - this.startTime,
          agent: ClaudeCodeAgent.id
        };
        this.emit('failed', { error: err.message });
        reject(err);
      });

      this.process.on('close', (code) => {
        const result = {
          exitCode: code,
          output: this.output,
          durationMs: Date.now() - this.startTime,
          agent: ClaudeCodeAgent.id
        };

        if (code === 0) {
          this.emit('completed', { result });
          resolve(result);
        } else {
          result.error = `Process exited with code ${code}`;
          this.emit('failed', { error: result.error });
          reject(new Error(result.error));
        }
      });
    });
  }

  buildArgs(task) {
    const args = ['-p', task.prompt];

    // Output format
    if (this.config.outputFormat) {
      args.push('--output-format', this.config.outputFormat);
    }

    // Max turns
    if (this.config.maxTurns) {
      args.push('--max-turns', this.config.maxTurns.toString());
    }

    // Model override
    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    // System prompt
    if (this.config.systemPrompt) {
      args.push('--system-prompt', this.config.systemPrompt);
    }

    // Allowed tools
    if (this.config.permissions?.allowTools?.length > 0) {
      for (const tool of this.config.permissions.allowTools) {
        args.push('--allowedTools', tool);
      }
    }

    // Disallowed tools
    if (this.config.permissions?.denyTools?.length > 0) {
      for (const tool of this.config.permissions.denyTools) {
        args.push('--disallowedTools', tool);
      }
    }

    return args;
  }

  async stop() {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.running = false;
  }
}

module.exports = { ClaudeCodeAgent };
