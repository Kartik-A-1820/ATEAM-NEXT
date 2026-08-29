import {initialState, reduce} from '../domain/state.js';
import type {AppState} from '../domain/types.js';
import {AteamStore, type StoredSession} from './store.js';

export function replaySession(store: AteamStore, sessionId: string): AppState | undefined {
  const session = store.getSession(sessionId);
  if (!session) return undefined;
  let state = initialState();
  state = {...state, sessionId: session.id, conversation: []};
  for (const item of store.eventsForSession(sessionId)) {
    state = reduce(state, item.event);
  }
  return state;
}

export function formatSessionList(sessions: StoredSession[]): string {
  if (sessions.length === 0) return 'No sessions yet.\n';
  return sessions.map(session => `${session.id}\t${session.status}\t${new Date(session.updatedAt).toISOString()}\t${session.title}`).join('\n') + '\n';
}
