import type {AteamEvent} from '../domain/events.js';

export function formatAgentEvents(events: AteamEvent[]): string {
  const rows = events
    .filter(event => event.type === 'AgentAvailabilityChanged')
    .map(event => {
      const version = event.version ? `\t${event.version}` : '\t-';
      const reason = event.reason ? `\t${event.reason}` : '';
      return `${event.agentId}\t${event.availability}${version}${reason}`;
    });
  return `${rows.join('\n')}\n`;
}
