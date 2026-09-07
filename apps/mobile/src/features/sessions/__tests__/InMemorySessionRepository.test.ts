import { InMemorySessionRepository } from '../InMemorySessionRepository';
import { describeSessionRepositoryContract } from './sessionRepository.contract';

describeSessionRepositoryContract('InMemorySessionRepository', () =>
  Promise.resolve({
    repository: new InMemorySessionRepository(),
    dispose: () => Promise.resolve(),
  }),
);
