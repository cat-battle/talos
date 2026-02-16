/**
 * Claude Code Agent Adapter
 * 
 * Adapter for Anthropic's Claude Code CLI.
 * Uses stdin piping instead of -p flag (which hangs in non-TTY environments).
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

  static async isAvailable(config = {}) {
    const command = config.command || config.claudeCommand || 'claude';
    try {
      // Try configured command directly
      execSync(`${command} --version`, { stdio: 'ignore' });
      return true;
    } catch {
      // Fallback: check common paths
      const commonPaths = [
        'claude',
        '/usr/local/bin/claude',
        '/usr/bin/claude',
        `${process.env.HOME}/.local/bin/claude`
      ];
      for (const path of commonPaths) {
        try {
          execSync(`${path} --version`, { stdio: 'ignore' });
          return true;
        } catch {}
      }
      return false;
    }
  }

  static async getVersion(config = {}) {
    const command = config.command || config.claudeCommand || 'claude';
    try {
      const version = execSync(`${command} --version`, { encoding: 'utf-8' }).trim();
      return version;
    } catch {
      // Fallback: check common paths
      const commonPaths = [
        'claude',
        `${process.env.HOME}/.local/bin/claude`
      ];
      for (const path of commonPaths) {
        try {
          return execSync(`${path} --version`, { encoding: 'utf-8' }).trim();
        } catch {}
      }
      return 'unknown';
    }
  }

  async execute(task, options = {}) {
    this.running = true;
    this.output = '';
    this.startTime = Date.now();

    this.emit('started', { task });

    const mode = this.config.execution?.mode || 'pipe';

    try {
      if (mode === 'dangerously-skip-permissions') {
        return await this._executePipe(task, true);
      } else {
        return await this._executePipe(task, false);
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Execute by piping prompt to stdin
   * Works around -p flag hanging in non-TTY environments
   */
  async _executePipe(task, skipPermissions = false) {
    const workDir = task.workingDir || process.cwd();
    const command = this.config.claudeCommand || 'claude';
    const args = this.buildArgs(task, skipPermissions);

    this.info(`Executing: echo "..." | ${command} ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      this.process = spawn(command, args, {
        cwd: workDir,
        env: { ...process.env },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Write prompt to stdin and close it
      this.process.stdin.write(task.prompt);
      this.process.stdin.end();

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

  buildArgs(task, skipPermissions = false) {
    // No -p flag - we pipe to stdin instead
    const args = [];

    // Skip permissions if requested
    if (skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

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
