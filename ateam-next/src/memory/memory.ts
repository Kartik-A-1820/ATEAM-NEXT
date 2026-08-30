import type {AgentId} from '../domain/types.js';

export type MemoryCategory = 'FACT' | 'HYPOTHESIS' | 'DECISION' | 'USER_CONSTRAINT' | 'AGENT_FINDING' | 'TEST_RESULT';
export type VerificationState = 'UNVERIFIED' | 'SUPPORTED' | 'VERIFIED' | 'REJECTED' | 'STALE';

export interface MemoryRecord {
  id: string;
  category: MemoryCategory;
  content: string;
  verification: VerificationState;
  sourceAgent?: AgentId;
  sourceTask?: string;
  evidence: string[];
  confidence?: number;
  createdAt: number;
}

export class MemoryStore {
  private readonly records: MemoryRecord[] = [];

  add(record: Omit<MemoryRecord, 'id' | 'createdAt'>): MemoryRecord {
    const stored = {...record, id: `M${this.records.length + 1}`, createdAt: Date.now()};
    this.records.push(stored);
    return stored;
  }

  list(category?: MemoryCategory): MemoryRecord[] {
    return category ? this.records.filter(record => record.category === category) : [...this.records];
  }

  constraints(): string[] {
    return this.records.filter(record => record.category === 'USER_CONSTRAINT' && record.verification !== 'REJECTED').map(record => record.content);
  }
}
