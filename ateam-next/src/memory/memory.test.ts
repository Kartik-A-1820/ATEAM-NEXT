import {describe, expect, it} from 'vitest';
import {MemoryStore} from './memory.js';

describe('MemoryStore', () => {
  it('tracks provenance-aware user constraints', () => {
    const store = new MemoryStore();
    store.add({category: 'USER_CONSTRAINT', content: 'Do not change public API', verification: 'VERIFIED', evidence: ['user message']});
    expect(store.constraints()).toEqual(['Do not change public API']);
  });
});
