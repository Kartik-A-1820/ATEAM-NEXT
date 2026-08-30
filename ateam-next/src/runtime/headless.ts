import {initialState, reduce} from '../domain/state.js';
import type {AteamEvent} from '../domain/events.js';
import type {AppState} from '../domain/types.js';
import {RuntimeController} from './runtime.js';
import type {SimulationScenario} from './simulator.js';
import type {AteamStore} from '../storage/store.js';
import {createDefaultProviders, type ProviderMap} from '../providers/registry.js';

export interface HeadlessSimulationResult {
  sessionId: string;
  prompt: string;
  scenario: SimulationScenario;
  status: 'completed' | 'failed' | 'cancelled';
  events: AteamEvent[];
  finalState: AppState;
}

export async function runHeadlessSimulation(prompt: string, scenario: SimulationScenario, store?: AteamStore): Promise<HeadlessSimulationResult> {
  const events: AteamEvent[] = [];
  let state = initialState(100, 30);
  store?.createSession(state.sessionId, titleFromPrompt(prompt), state.startedAt);
  const send = (event: AteamEvent) => {
    events.push(event);
    store?.appendEvent(state.sessionId, event);
    state = reduce(state, event);
  };

  const runtime = new RuntimeController(send, true, scenario);
  runtime.handle({kind: 'submitUserMessage', message: prompt});
  await new Promise(resolve => setTimeout(resolve, scenario === 'SLOW' ? 3200 : 1500));

  const failed = Object.values(state.tasks).some(task => task.status === 'FAILED');
  const cancelled = Object.values(state.tasks).some(task => task.status === 'CANCELLED');
  const status = failed ? 'failed' : cancelled ? 'cancelled' : 'completed';
  store?.finishSession(state.sessionId, status, Date.now());
  return {
    sessionId: state.sessionId,
    prompt,
    scenario,
    status,
    events,
    finalState: state,
  };
}

export async function runHeadlessProviders(prompt: string, store?: AteamStore, providers: ProviderMap = createDefaultProviders()): Promise<HeadlessSimulationResult> {
  const events: AteamEvent[] = [];
  let state = initialState(100, 30);
  store?.createSession(state.sessionId, titleFromPrompt(prompt), state.startedAt);
  const send = (event: AteamEvent) => {
    events.push(event);
    store?.appendEvent(state.sessionId, event);
    state = reduce(state, event);
  };

  const runtime = new RuntimeController(send, false, 'FAST', providers, undefined, store);
  runtime.handle({kind: 'submitUserMessage', message: prompt});
  await runtime.waitForIdle();

  const failed = Object.values(state.tasks).some(task => task.status === 'FAILED');
  const cancelled = Object.values(state.tasks).some(task => task.status === 'CANCELLED');
  const status = failed ? 'failed' : cancelled ? 'cancelled' : 'completed';
  store?.finishSession(state.sessionId, status, Date.now());
  return {
    sessionId: state.sessionId,
    prompt,
    scenario: 'FAST',
    status,
    events,
    finalState: state,
  };
}

function titleFromPrompt(prompt: string): string {
  return prompt.trim().slice(0, 80) || 'Untitled session';
}
