import { BleError } from '@beacon/ble-contracts';
import {
  characteristicOperationReducer,
  describeBusy,
  describeOutcome,
  initialOperationState,
} from '../characteristicOperations';

const AT = '2026-09-07T10:00:00.000Z';

describe('characteristicOperationReducer', () => {
  it('runs one operation at a time', () => {
    const reading = characteristicOperationReducer(initialOperationState, {
      type: 'read_started',
    });
    expect(reading.busy).toBe('reading');
    expect(
      characteristicOperationReducer(reading, {
        type: 'write_started',
        mode: 'with_response',
      }),
    ).toBe(reading);
    expect(characteristicOperationReducer(reading, { type: 'read_started' })).toBe(
      reading,
    );
  });

  it('records read outcomes and returns to idle', () => {
    const reading = characteristicOperationReducer(initialOperationState, {
      type: 'read_started',
    });
    const done = characteristicOperationReducer(reading, {
      type: 'read_succeeded',
      byteCount: 2,
      at: AT,
    });
    expect(done).toEqual({
      busy: 'idle',
      lastOutcome: { kind: 'read', ok: true, byteCount: 2, at: AT },
    });
    expect(describeOutcome(done.lastOutcome!)).toEqual({
      value: 'Read',
      detail: 'Read 2 bytes.',
    });

    const failed = characteristicOperationReducer(reading, {
      type: 'read_failed',
      error: new BleError({ code: 'read_failed', message: 'GATT status 2' }),
      at: AT,
    });
    expect(failed.busy).toBe('idle');
    expect(describeOutcome(failed.lastOutcome!)).toEqual({
      value: 'Read failed',
      detail: 'GATT status 2 (read_failed)',
    });
  });

  it('records write outcomes with their mode', () => {
    const writing = characteristicOperationReducer(initialOperationState, {
      type: 'write_started',
      mode: 'without_response',
    });
    expect(writing.busy).toBe('writing');
    const done = characteristicOperationReducer(writing, {
      type: 'write_succeeded',
      byteCount: 1,
      mode: 'without_response',
      at: AT,
    });
    expect(describeOutcome(done.lastOutcome!)).toEqual({
      value: 'Written',
      detail: 'Wrote 1 byte without response.',
    });
    const failed = characteristicOperationReducer(writing, {
      type: 'write_failed',
      error: new BleError({ code: 'disconnected', message: 'Link dropped' }),
      mode: 'with_response',
      at: AT,
    });
    expect(describeOutcome(failed.lastOutcome!)).toEqual({
      value: 'Write failed',
      detail: 'Link dropped (disconnected)',
    });
    expect(characteristicOperationReducer(failed, { type: 'reset' })).toBe(
      initialOperationState,
    );
  });

  it('labels the busy states', () => {
    expect(describeBusy('idle')).toBeUndefined();
    expect(describeBusy('reading')).toBe('Reading…');
    expect(describeBusy('writing')).toBe('Writing…');
  });
});
