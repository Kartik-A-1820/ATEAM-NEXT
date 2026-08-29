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
    this.db.prepare('INSERT INTO events (session_id, at, type, payload_json) VALUES (?, ?, ?, ?)').run(
      sessionId,
      parsed.at,
      parsed.type,
      JSON.stringify(parsed),
    );
    this.db.prepare('UPDATE sessions SET updated_at = ?, status = ? WHERE id = ?').run(
      parsed.at,
      statusFromEvent(parsed),
      sessionId,
    );
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
