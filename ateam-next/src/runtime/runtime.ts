import {Simulator, type SimulationScenario} from './simulator.js';
import type {AteamEvent, RuntimeCommand} from '../domain/events.js';

export class RuntimeController {
  private simulator?: Simulator;

  constructor(private readonly send: (event: AteamEvent) => void, private readonly simulate: boolean, private readonly scenario: SimulationScenario) {
    if (simulate) {
      this.simulator = new Simulator(send);
    }
  }

  handle(command: RuntimeCommand): void {
    const at = Date.now();
    switch (command.kind) {
      case 'submitUserMessage':
        this.send({type: 'UserMessageReceived', message: command.message, at});
        if (this.simulator) {
          this.simulator.run(command.message, this.scenario);
        }
        return;
      case 'setVerbosity':
        this.send({type: 'VerbosityChanged', verbosity: command.verbosity, at});
        return;
      case 'setPermissionMode':
        this.send({type: 'PermissionModeChanged', mode: command.mode, at});
        return;
      case 'stop':
        this.simulator?.cancel(command.scope);
        this.send({type: 'StopRequested', scope: command.scope, at});
        return;
      case 'slashCommand':
        this.send({type: 'PlanUpdated', summary: `/${command.name} is registered; detailed view plumbing is in progress.`, at});
        return;
      case 'quit':
        this.simulator?.cancel('shutdown');
        return;
      default:
        return;
    }
  }
}
