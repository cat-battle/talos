/**
 * Memory Manager
 * Persistent learning and context system for Talos
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class MemoryManager {
  constructor(memoryDir) {
    this.memoryDir = memoryDir;
    this.projectsDir = path.join(memoryDir, 'projects');
    this.patternsPath = path.join(memoryDir, 'patterns.json');
    this.indexPath = path.join(memoryDir, 'index.json');
    
    this._ensureStructure();
  }

  // ============================================
  // Initialization
  // ============================================

  _ensureStructure() {
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
    if (!fs.existsSync(this.projectsDir)) {
      fs.mkdirSync(this.projectsDir, { recursive: true });
    }
    if (!fs.existsSync(this.patternsPath)) {
      this._writeJSON(this.patternsPath, {
        toolApprovals: {},      // tool -> { approved: n, denied: n, autoApprove: bool }
        averageDurations: {},   // taskType -> avgMs
        successPatterns: [],    // prompts/approaches that worked
        failurePatterns: []     // prompts/approaches that failed
      });
    }
    if (!fs.existsSync(this.indexPath)) {
      this._writeJSON(this.indexPath, {
        projects: {},           // projectId -> { path, lastAccess, taskCount }
        keywords: {}            // keyword -> [{ projectId, taskId, score }]
      });
    }
  }

  // ============================================
  // Project Management
  // ============================================

  /**
   * Get or create a project context by working directory
   */
  getProject(workingDir) {
    const projectId = this._hashPath(workingDir || 'default');
    const projectDir = path.join(this.projectsDir, projectId);
    
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
      
      // Initialize project files
      this._writeJSON(path.join(projectDir, 'meta.json'), {
        id: projectId,
        path: workingDir,
        createdAt: new Date().toISOString(),
        taskCount: 0
      });
      
      fs.writeFileSync(path.join(projectDir, 'context.md'), 
        `# Project Context\n\nPath: ${workingDir || 'default'}\n\n## Learnings\n\n`);
      
      fs.writeFileSync(path.join(projectDir, 'tasks.jsonl'), '');
      
      // Update index
      const index = this._readJSON(this.indexPath);
      index.projects[projectId] = {
        path: workingDir,
        lastAccess: new Date().toISOString(),
        taskCount: 0
      };
      this._writeJSON(this.indexPath, index);
    }
    
    return {
      id: projectId,
      dir: projectDir,
      meta: this._readJSON(path.join(projectDir, 'meta.json')),
      context: fs.readFileSync(path.join(projectDir, 'context.md'), 'utf-8')
    };
  }

  // ============================================
  // Task History
  // ============================================

  /**
   * Record a completed task
   */
  recordTask(task, result) {
    const project = this.getProject(task.workingDir);
    const tasksPath = path.join(project.dir, 'tasks.jsonl');
    
    const record = {
      id: task.id,
      title: task.title,
      prompt: task.prompt,
      type: task.type,
      completedAt: new Date().toISOString(),
      success: result.exitCode === 0,
      durationMs: result.durationMs,
      mode: result.mode,
      outputSummary: this._summarize(result.output, 500),
      error: result.error || null
    };
    
    // Append to task history
    fs.appendFileSync(tasksPath, JSON.stringify(record) + '\n');
    
    // Update meta
    const metaPath = path.join(project.dir, 'meta.json');
    const meta = this._readJSON(metaPath);
    meta.taskCount++;
    meta.lastTaskAt = record.completedAt;
    this._writeJSON(metaPath, meta);
    
    // Update patterns
    this._updatePatterns(task, result);
    
    // Index keywords
    this._indexTask(project.id, record);
    
    return record;
  }

  /**
   * Get recent tasks for a project
   */
  getRecentTasks(workingDir, limit = 10) {
    const project = this.getProject(workingDir);
    const tasksPath = path.join(project.dir, 'tasks.jsonl');
    
    if (!fs.existsSync(tasksPath)) return [];
    
    const lines = fs.readFileSync(tasksPath, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean);
    
    return lines
      .slice(-limit)
      .map(line => JSON.parse(line))
      .reverse();
  }

  // ============================================
  // Context Retrieval
  // ============================================

  /**
   * Get relevant context for a new task
   */
  getContextForTask(task) {
    const project = this.getProject(task.workingDir);
    const recentTasks = this.getRecentTasks(task.workingDir, 5);
    const patterns = this.getPatterns();
    
    const context = {
      projectContext: project.context,
      recentTasks: recentTasks.map(t => ({
        title: t.title,
        prompt: t.prompt,
        success: t.success,
        summary: t.outputSummary
      })),
      relevantPatterns: this._findRelevantPatterns(task.prompt, patterns),
      suggestedApprovals: this._getSuggestedApprovals(patterns)
    };
    
    return context;
  }

  /**
   * Build a context string to inject into the prompt
   */
  buildContextPrompt(task) {
    const ctx = this.getContextForTask(task);
    let prompt = '';
    
    // Add project context if exists
    if (ctx.projectContext && ctx.projectContext.includes('## Learnings')) {
      const learnings = ctx.projectContext.split('## Learnings')[1]?.trim();
      if (learnings && learnings.length > 10) {
        prompt += `\n<project_context>\n${learnings}\n</project_context>\n`;
      }
    }
    
    // Add recent successful tasks as examples
    const successfulTasks = ctx.recentTasks.filter(t => t.success).slice(0, 3);
    if (successfulTasks.length > 0) {
      prompt += '\n<recent_context>\n';
      prompt += 'Recent successful tasks in this project:\n';
      for (const t of successfulTasks) {
        prompt += `- ${t.title}: ${t.summary?.slice(0, 100) || 'completed'}\n`;
      }
      prompt += '</recent_context>\n';
    }
    
    return prompt;
  }

  // ============================================
  // Pattern Learning
  // ============================================

  getPatterns() {
    return this._readJSON(this.patternsPath);
  }

  _updatePatterns(task, result) {
    const patterns = this.getPatterns();
    
    // Update duration averages
    const taskType = task.type || 'general';
    if (!patterns.averageDurations[taskType]) {
      patterns.averageDurations[taskType] = { total: 0, count: 0 };
    }
    patterns.averageDurations[taskType].total += result.durationMs || 0;
    patterns.averageDurations[taskType].count++;
    
    // Track success/failure patterns (simple keyword extraction)
    const keywords = this._extractKeywords(task.prompt);
    if (result.exitCode === 0) {
      patterns.successPatterns.push({
        keywords,
        timestamp: new Date().toISOString()
      });
      // Keep only last 100
      if (patterns.successPatterns.length > 100) {
        patterns.successPatterns = patterns.successPatterns.slice(-100);
      }
    } else {
      patterns.failurePatterns.push({
        keywords,
        error: result.error?.slice(0, 200),
        timestamp: new Date().toISOString()
      });
      if (patterns.failurePatterns.length > 100) {
        patterns.failurePatterns = patterns.failurePatterns.slice(-100);
      }
    }
    
    this._writeJSON(this.patternsPath, patterns);
  }

  /**
   * Record a tool approval/denial
   */
  recordToolDecision(tool, approved) {
    const patterns = this.getPatterns();
    
    if (!patterns.toolApprovals[tool]) {
      patterns.toolApprovals[tool] = { approved: 0, denied: 0, autoApprove: false };
    }
    
    if (approved) {
      patterns.toolApprovals[tool].approved++;
      // Auto-approve after 5 consecutive approvals
      if (patterns.toolApprovals[tool].approved >= 5 && 
          patterns.toolApprovals[tool].denied === 0) {
        patterns.toolApprovals[tool].autoApprove = true;
      }
    } else {
      patterns.toolApprovals[tool].denied++;
      patterns.toolApprovals[tool].autoApprove = false;
    }
    
    this._writeJSON(this.patternsPath, patterns);
  }

  /**
   * Check if a tool should be auto-approved
   */
  shouldAutoApprove(tool) {
    const patterns = this.getPatterns();
    return patterns.toolApprovals[tool]?.autoApprove || false;
  }

  _getSuggestedApprovals(patterns) {
    return Object.entries(patterns.toolApprovals)
      .filter(([_, v]) => v.autoApprove)
      .map(([tool, _]) => tool);
  }

  _findRelevantPatterns(prompt, patterns) {
    const promptKeywords = this._extractKeywords(prompt);
    const relevant = [];
    
    // Find similar successful patterns
    for (const pattern of patterns.successPatterns.slice(-20)) {
      const overlap = pattern.keywords.filter(k => promptKeywords.includes(k));
      if (overlap.length >= 2) {
        relevant.push({ type: 'success', keywords: overlap });
      }
    }
    
    // Find similar failure patterns to warn about
    for (const pattern of patterns.failurePatterns.slice(-20)) {
      const overlap = pattern.keywords.filter(k => promptKeywords.includes(k));
      if (overlap.length >= 2) {
        relevant.push({ type: 'failure', keywords: overlap, error: pattern.error });
      }
    }
    
    return relevant.slice(0, 5);
  }

  // ============================================
  // Context Updates
  // ============================================

  /**
   * Append a learning to the project context
   */
  addLearning(workingDir, learning) {
    const project = this.getProject(workingDir);
    const contextPath = path.join(project.dir, 'context.md');
    
    const timestamp = new Date().toISOString().split('T')[0];
    const entry = `\n- [${timestamp}] ${learning}`;
    
    fs.appendFileSync(contextPath, entry);
  }

  /**
   * Extract key learnings from a task result (for future: use LLM)
   */
  extractLearnings(task, result) {
    // Simple heuristic extraction for now
    const learnings = [];
    
    if (result.exitCode === 0 && result.output) {
      // Look for patterns like "Created", "Updated", "Fixed"
      const actions = result.output.match(/(?:Created|Updated|Fixed|Added|Removed|Refactored)\s+[^\n.]+/gi);
      if (actions) {
        learnings.push(...actions.slice(0, 3));
      }
    }
    
    if (result.error) {
      learnings.push(`Failed: ${result.error.slice(0, 100)}`);
    }
    
    return learnings;
  }

  // ============================================
  // Search
  // ============================================

  /**
   * Search across all task history
   */
  search(query, limit = 10) {
    const queryKeywords = this._extractKeywords(query);
    const index = this._readJSON(this.indexPath);
    const results = [];
    
    // Simple keyword matching (future: embeddings)
    for (const keyword of queryKeywords) {
      const matches = index.keywords[keyword] || [];
      for (const match of matches) {
        const existing = results.find(r => r.taskId === match.taskId);
        if (existing) {
          existing.score += match.score;
        } else {
          results.push({ ...match });
        }
      }
    }
    
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  _indexTask(projectId, record) {
    const index = this._readJSON(this.indexPath);
    const keywords = this._extractKeywords(record.prompt + ' ' + record.title);
    
    for (const keyword of keywords) {
      if (!index.keywords[keyword]) {
        index.keywords[keyword] = [];
      }
      index.keywords[keyword].push({
        projectId,
        taskId: record.id,
        score: 1
      });
      // Keep index manageable
      if (index.keywords[keyword].length > 50) {
        index.keywords[keyword] = index.keywords[keyword].slice(-50);
      }
    }
    
    this._writeJSON(this.indexPath, index);
  }

  // ============================================
  // Utilities
  // ============================================

  _hashPath(p) {
    return crypto.createHash('sha256').update(p).digest('hex').slice(0, 12);
  }

  _readJSON(filepath) {
    try {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    } catch {
      return {};
    }
  }

  _writeJSON(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  }

  _summarize(text, maxLen = 500) {
    if (!text) return null;
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '...';
  }

  _extractKeywords(text) {
    if (!text) return [];
    
    // Simple keyword extraction
    const stopwords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'this',
      'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
      'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each',
      'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
      'not', 'only', 'same', 'so', 'than', 'too', 'very', 'just', 'also'
    ]);
    
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopwords.has(w))
      .slice(0, 20);
  }

  // ============================================
  // Stats
  // ============================================

  getStats() {
    const index = this._readJSON(this.indexPath);
    const patterns = this.getPatterns();
    
    const projectCount = Object.keys(index.projects).length;
    const keywordCount = Object.keys(index.keywords).length;
    
    let totalTasks = 0;
    for (const p of Object.values(index.projects)) {
      totalTasks += p.taskCount || 0;
    }
    
    const avgDurations = {};
    for (const [type, data] of Object.entries(patterns.averageDurations)) {
      avgDurations[type] = Math.round(data.total / data.count);
    }
    
    return {
      projects: projectCount,
      totalTasks,
      indexedKeywords: keywordCount,
      successPatterns: patterns.successPatterns.length,
      failurePatterns: patterns.failurePatterns.length,
      autoApprovedTools: Object.entries(patterns.toolApprovals)
        .filter(([_, v]) => v.autoApprove)
        .map(([t, _]) => t),
      avgDurations
    };
  }
}

module.exports = { MemoryManager };
