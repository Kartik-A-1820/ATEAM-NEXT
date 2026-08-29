import {initialState, reduce} from '../domain/state.js';
import type {AteamEvent} from '../domain/events.js';
import type {AppState} from '../domain/types.js';
import {RuntimeController} from './runtime.js';
import type {SimulationScenario} from './simulator.js';

export interface HeadlessSimulationResult {
  sessionId: string;
  prompt: string;
  scenario: SimulationScenario;
  status: 'completed' | 'failed' | 'cancelled';
  events: AteamEvent[];
  finalState: AppState;
}

export async function runHeadlessSimulation(prompt: string, scenario: SimulationScenario): Promise<HeadlessSimulationResult> {
  const events: AteamEvent[] = [];
  let state = initialState(100, 30);
  const send = (event: AteamEvent) => {
    events.push(event);
    state = reduce(state, event);
  };

  const runtime = new RuntimeController(send, true, scenario);
  runtime.handle({kind: 'submitUserMessage', message: prompt});
  await new Promise(resolve => setTimeout(resolve, scenario === 'SLOW' ? 3200 : 1500));

  const failed = Object.values(state.tasks).some(task => task.status === 'FAILED');
  const cancelled = Object.values(state.tasks).some(task => task.status === 'CANCELLED');
  return {
    sessionId: state.sessionId,
    prompt,
    scenario,
    status: failed ? 'failed' : cancelled ? 'cancelled' : 'completed',
    events,
    finalState: state,
  };
}
