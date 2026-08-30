import Database from 'better-sqlite3';
import {mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';
import type {AteamEvent} from '../domain/events.js';
import {eventSchema} from '../domain/events.js';

export interface StoredSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
}

export interface StoredEvent {
  id: number;
  sessionId: string;
  at: number;
  type: string;
  event: AteamEvent;
}

export interface StoredMessage {
  id: number;
  sessionId: string;
  speaker: string;
  text: string;
  at: number;
}

export interface StoredTask {
  id: string;
  sessionId: string;
  objective: string;
  status: string;
  assignedAgent?: string;
  priority: number;
}

export interface StoredMemory {
  id: number;
  externalId?: string;
  sessionId?: string;
  category: string;
  content: string;
  sourceAgent?: string;
  sourceTask?: string;
  verificationState: string;
  evidence: string[];
  confidence?: number;
  createdAt: number;
}

export class AteamStore {
  private readonly db: Database.Database;

  constructor(readonly path: string = defaultStorePath()) {
    mkdirSync(dirname(path), {recursive: true});
    this.db = new Database(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  createSession(id: string, title: string, createdAt = Date.now()): StoredSession {
    this.db.prepare(`
      INSERT INTO sessions (id, title, created_at, updated_at, status)
      VALUES (?, ?, ?, ?, 'active')
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at
    `).run(id, title, createdAt, createdAt);
    return {id, title, createdAt, updatedAt: createdAt, status: 'active'};
  }

  appendEvent(sessionId: string, event: AteamEvent): void {
    const parsed = eventSchema.parse(event);
    const tx = this.db.transaction(() => {
      this.db.prepare('INSERT INTO events (session_id, at, type, payload_json) VALUES (?, ?, ?, ?)').run(
        sessionId,
        parsed.at,
        parsed.type,
        JSON.stringify(parsed),
      );
      this.projectEvent(sessionId, parsed);
      this.db.prepare('UPDATE sessions SET updated_at = ?, status = ? WHERE id = ?').run(
        parsed.at,
        statusFromEvent(parsed),
        sessionId,
      );
    });
    tx();
  }

  finishSession(id: string, status: StoredSession['status'] = 'completed', updatedAt = Date.now()): void {
    this.db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?').run(status, updatedAt, id);
  }

  listSessions(limit = 20): StoredSession[] {
    const rows = this.db.prepare(`
      SELECT id, title, created_at as createdAt, updated_at as updatedAt, status
      FROM sessions ORDER BY updated_at DESC LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
    return rows.map(sessionFromRow);
  }

  getSession(id: string): StoredSession | undefined {
    const row = this.db.prepare(`
      SELECT id, title, created_at as createdAt, updated_at as updatedAt, status
      FROM sessions WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;
    return row ? sessionFromRow(row) : undefined;
  }

  latestSession(): StoredSession | undefined {
    return this.listSessions(1)[0];
  }

  eventsForSession(sessionId: string): StoredEvent[] {
    const rows = this.db.prepare(`
      SELECT id, session_id as sessionId, at, type, payload_json as payloadJson
      FROM events WHERE session_id = ? ORDER BY id ASC
    `).all(sessionId) as Array<{id: number; sessionId: string; at: number; type: string; payloadJson: string}>;

    return rows.map(row => ({
      id: row.id,
      sessionId: row.sessionId,
      at: row.at,
      type: row.type,
      event: eventSchema.parse(JSON.parse(row.payloadJson)),
    }));
  }

  messagesForSession(sessionId: string): StoredMessage[] {
    const rows = this.db.prepare(`
      SELECT id, session_id as sessionId, speaker, text, at
      FROM messages WHERE session_id = ? ORDER BY id ASC
    `).all(sessionId) as Array<Record<string, unknown>>;
    return rows.map(row => ({
      id: Number(row.id),
      sessionId: String(row.sessionId),
      speaker: String(row.speaker),
      text: String(row.text),
      at: Number(row.at),
    }));
  }

  tasksForSession(sessionId: string): StoredTask[] {
    const rows = this.db.prepare(`
      SELECT id, session_id as sessionId, objective, status, assigned_agent as assignedAgent, priority
      FROM tasks WHERE session_id = ? ORDER BY id ASC
    `).all(sessionId) as Array<Record<string, unknown>>;
    return rows.map(row => ({
      id: String(row.id),
      sessionId: String(row.sessionId),
      objective: String(row.objective),
      status: String(row.status),
      assignedAgent: typeof row.assignedAgent === 'string' ? row.assignedAgent : undefined,
      priority: Number(row.priority),
    }));
  }

  memoriesForSession(sessionId: string): StoredMemory[] {
    const rows = this.db.prepare(`
      SELECT id, external_id as externalId, session_id as sessionId, category, content, source_agent as sourceAgent,
        source_task as sourceTask, verification_state as verificationState, evidence_json as evidenceJson,
        confidence, created_at as createdAt
      FROM memories WHERE session_id = ? ORDER BY id ASC
    `).all(sessionId) as Array<Record<string, unknown>>;
    return rows.map(memoryFromRow);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    const applied = new Set((this.db.prepare('SELECT version FROM schema_migrations').all() as Array<{version: number}>).map(row => row.version));
    if (!applied.has(1)) {
      this.db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'failed', 'cancelled'))
        );

        CREATE TABLE events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          at INTEGER NOT NULL,
          type TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );

        CREATE INDEX events_session_id_idx ON events(session_id, id);
        CREATE INDEX sessions_updated_at_idx ON sessions(updated_at DESC);

        CREATE TABLE messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          speaker TEXT NOT NULL,
          text TEXT NOT NULL,
          at INTEGER NOT NULL
        );

        CREATE TABLE tasks (
          id TEXT NOT NULL,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          objective TEXT NOT NULL,
          status TEXT NOT NULL,
          assigned_agent TEXT,
          priority INTEGER NOT NULL DEFAULT 50,
          PRIMARY KEY (session_id, id)
        );

        CREATE TABLE memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          category TEXT NOT NULL,
          content TEXT NOT NULL,
          source_agent TEXT,
          source_task TEXT,
          verification_state TEXT NOT NULL DEFAULT 'UNVERIFIED',
          evidence_json TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL
        );
      `);
      this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)').run(Date.now());
    }
    if (!applied.has(2)) {
      this.addColumnIfMissing('memories', 'external_id', 'TEXT');
      this.addColumnIfMissing('memories', 'confidence', 'REAL');
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS memories_session_external_id_idx ON memories(session_id, external_id);
        CREATE INDEX IF NOT EXISTS messages_session_id_idx ON messages(session_id, id);
        CREATE INDEX IF NOT EXISTS tasks_session_id_idx ON tasks(session_id, id);
      `);
      this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)').run(Date.now());
    }
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name: string}>;
    if (!rows.some(row => row.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private projectEvent(sessionId: string, event: AteamEvent): void {
    switch (event.type) {
      case 'UserMessageReceived':
        this.db.prepare('INSERT INTO messages (session_id, speaker, text, at) VALUES (?, ?, ?, ?)').run(sessionId, 'You', event.message, event.at);
        return;
      case 'PlanUpdated':
        this.db.prepare('INSERT INTO messages (session_id, speaker, text, at) VALUES (?, ?, ?, ?)').run(sessionId, 'Ateam', event.summary, event.at);
        return;
      case 'RuntimeError':
        this.db.prepare('INSERT INTO messages (session_id, speaker, text, at) VALUES (?, ?, ?, ?)').run(sessionId, 'System', `Error: ${event.message}`, event.at);
        return;
      case 'TaskCreated':
        this.db.prepare(`
          INSERT INTO tasks (session_id, id, objective, status, assigned_agent, priority)
          VALUES (?, ?, ?, 'READY', ?, 50)
          ON CONFLICT(session_id, id) DO UPDATE SET
            objective = excluded.objective,
            assigned_agent = COALESCE(excluded.assigned_agent, tasks.assigned_agent)
        `).run(sessionId, event.taskId, event.objective, event.assignedAgent ?? null);
        return;
      case 'TaskAssigned':
        this.db.prepare('UPDATE tasks SET assigned_agent = ? WHERE session_id = ? AND id = ?').run(event.agentId, sessionId, event.taskId);
        return;
      case 'TaskStatusChanged':
        this.db.prepare('UPDATE tasks SET status = ? WHERE session_id = ? AND id = ?').run(event.status, sessionId, event.taskId);
        return;
      case 'TaskInvalidated':
        this.db.prepare('UPDATE tasks SET status = ? WHERE session_id = ? AND id = ?').run('INVALIDATED', sessionId, event.taskId);
        return;
      case 'MemoryUpdated':
        this.db.prepare(`
          INSERT INTO memories (
            session_id, external_id, category, content, source_agent, source_task,
            verification_state, evidence_json, confidence, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id, external_id) DO UPDATE SET
            category = excluded.category,
            content = excluded.content,
            source_agent = excluded.source_agent,
            source_task = excluded.source_task,
            verification_state = excluded.verification_state,
            evidence_json = excluded.evidence_json,
            confidence = excluded.confidence
        `).run(
          sessionId,
          event.memoryId,
          event.category,
          event.content,
          event.sourceAgent ?? null,
          event.sourceTask ?? null,
          event.verification,
          JSON.stringify(event.evidence ?? []),
          event.confidence ?? null,
          event.at,
        );
        return;
      default:
        return;
    }
  }
}

export function defaultStorePath(): string {
  return process.env.ATEAM_DB_PATH ?? join(homedir(), '.ateam-next', 'ateam.sqlite');
}

function statusFromEvent(event: AteamEvent): StoredSession['status'] {
  if (event.type === 'RuntimeError') return 'failed';
  if (event.type === 'StopRequested') return 'cancelled';
  return 'active';
}

function sessionFromRow(row: Record<string, unknown>): StoredSession {
  return {
    id: String(row.id),
    title: String(row.title),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    status: row.status as StoredSession['status'],
  };
}

function memoryFromRow(row: Record<string, unknown>): StoredMemory {
  return {
    id: Number(row.id),
    externalId: typeof row.externalId === 'string' ? row.externalId : undefined,
    sessionId: typeof row.sessionId === 'string' ? row.sessionId : undefined,
    category: String(row.category),
    content: String(row.content),
    sourceAgent: typeof row.sourceAgent === 'string' ? row.sourceAgent : undefined,
    sourceTask: typeof row.sourceTask === 'string' ? row.sourceTask : undefined,
    verificationState: String(row.verificationState),
    evidence: JSON.parse(String(row.evidenceJson)) as string[],
    confidence: typeof row.confidence === 'number' ? row.confidence : undefined,
    createdAt: Number(row.createdAt),
  };
}
