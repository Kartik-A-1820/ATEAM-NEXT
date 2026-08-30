import {classifyMessage, Simulator, type SimulationScenario} from './simulator.js';
import {tabForCommand, type AteamEvent, type RuntimeCommand} from '../domain/events.js';
import {createInitialTaskGraph} from '../planner/taskGraph.js';
import {initialState} from '../domain/state.js';
import {scheduleTask} from '../scheduler/scheduler.js';

export class RuntimeController {
  private simulator?: Simulator;
  private active = false;

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
        {
          const classification = classifyMessage(command.message);
          this.send({type: 'UserMessageClassified', classification, at});
          if (this.active && classification !== 'ADDITIONAL_TASK') {
            this.send({type: 'ContextUpdated', summary: command.message, at});
            this.send({type: 'PlanUpdated', summary: 'Active plan updated from latest user instruction; obsolete simulated work will be reconsidered.', at});
            return;
          }
        }
        if (this.simulator) {
          this.planAndSchedule(command.message, at);
          this.active = true;
          this.simulator.run(command.message, this.scenario, {emitClassification: false});
        }
        return;
      case 'setVerbosity':
        this.send({type: 'VerbosityChanged', verbosity: command.verbosity, at});
        return;
      case 'setPermissionMode':
        this.send({type: 'PermissionModeChanged', mode: command.mode, at});
        return;
      case 'stop':
        this.simulator?.cancel();
        this.active = false;
        this.send({type: 'StopRequested', scope: command.scope, at});
        return;
      case 'slashCommand':
        this.handleSlashCommand(command.name, command.args, at);
        return;
      case 'quit':
        this.simulator?.cancel();
        this.active = false;
        this.send({type: 'StopRequested', scope: 'shutdown', at});
        return;
      default:
        return;
    }
  }

  private handleSlashCommand(name: string, args: string[], at: number): void {
    const tab = tabForCommand(name);
    if (tab) {
      this.send({type: 'ViewChanged', tab, at});
      this.send({type: 'PlanUpdated', summary: `${tab} view selected.`, at});
      return;
    }
    if (name === 'clear') {
      this.send({type: 'PlanUpdated', summary: 'Clear is registered; conversation pruning will move into persisted session state.', at});
      return;
    }
    if (name === 'resume') {
      this.send({type: 'PlanUpdated', summary: 'Resume requires SQLite persistence and is planned for Milestone 4.', at});
      return;
    }
    this.send({type: 'RuntimeError', message: args[0] ? `Unknown command /${args[0]}` : `Unknown command /${name}`, at});
  }

  private planAndSchedule(objective: string, at: number): void {
    const graph = createInitialTaskGraph(objective);
    const state = initialState();
    for (const task of graph.tasks) {
      this.send({type: 'TaskCreated', taskId: `P-${task.id}`, objective: task.objective, dependencies: task.dependencies.map(dep => `P-${dep}`), at});
      const assignment = scheduleTask(task, state.agents);
      if (assignment) {
        this.send({type: 'TaskAssigned', taskId: `P-${task.id}`, agentId: assignment.agentId, reason: assignment.reason, at});
      }
    }
    this.send({type: 'PlanUpdated', summary: `Plan created for: ${objective}`, at});
  }
}
