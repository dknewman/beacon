import { BleError } from '@beacon/ble-contracts';
import {
  describeSubscription,
  initialSubscriptionsState,
  subscriptionKey,
  subscriptionOf,
  subscriptionsReducer,
  type SubscriptionsState,
} from '../subscriptionReducer';

const HR = subscriptionKey('a', '180D', '2A37');
const BATTERY = subscriptionKey('a', '180F', '2A19');
const OTHER = subscriptionKey('b', '180F', '2A19');

function reduce(
  state: SubscriptionsState,
  ...actions: Parameters<typeof subscriptionsReducer>[1][]
) {
  return actions.reduce(subscriptionsReducer, state);
}

describe('subscriptionsReducer', () => {
  it('walks off → subscribing → on → unsubscribing → off', () => {
    let state = reduce(initialSubscriptionsState, {
      type: 'subscribe_requested',
      key: HR,
    });
    expect(subscriptionOf(state, HR).phase).toBe('subscribing');
    // A second request while in flight changes nothing.
    expect(reduce(state, { type: 'subscribe_requested', key: HR })).toBe(state);
    state = reduce(state, { type: 'subscribe_succeeded', key: HR });
    expect(subscriptionOf(state, HR).phase).toBe('on');
    state = reduce(state, { type: 'unsubscribe_requested', key: HR });
    expect(subscriptionOf(state, HR).phase).toBe('unsubscribing');
    state = reduce(state, { type: 'unsubscribe_succeeded', key: HR });
    expect(subscriptionOf(state, HR)).toEqual({ phase: 'off', notificationCount: 0 });
  });

  it('ignores acknowledgements that do not match the phase', () => {
    const state = initialSubscriptionsState;
    expect(reduce(state, { type: 'subscribe_succeeded', key: HR })).toBe(state);
    expect(reduce(state, { type: 'unsubscribe_requested', key: HR })).toBe(state);
    expect(reduce(state, { type: 'unsubscribe_succeeded', key: HR })).toBe(state);
  });

  it('keeps the failure reason and returns to off after a failed subscribe', () => {
    const error = new BleError({
      code: 'subscription_failed',
      message: 'CCCD write failed',
    });
    const state = reduce(
      initialSubscriptionsState,
      { type: 'subscribe_requested', key: HR },
      { type: 'subscribe_failed', key: HR, error },
    );
    expect(subscriptionOf(state, HR)).toEqual({
      phase: 'off',
      notificationCount: 0,
      lastError: error,
    });
    expect(describeSubscription(subscriptionOf(state, HR))).toEqual({
      value: 'Failed',
      detail: 'CCCD write failed (subscription_failed)',
    });
    // The next request clears the reason.
    const retried = reduce(state, { type: 'subscribe_requested', key: HR });
    expect(subscriptionOf(retried, HR).lastError).toBeUndefined();
  });

  it('stays on when unsubscribing fails, because native still delivers values', () => {
    const error = new BleError({ code: 'subscription_failed', message: 'status 133' });
    const state = reduce(
      initialSubscriptionsState,
      { type: 'subscribe_requested', key: HR },
      { type: 'subscribe_succeeded', key: HR },
      {
        type: 'values_received',
        counts: [{ key: HR, count: 3, at: '2026-09-07T10:00:00.300Z' }],
      },
      { type: 'unsubscribe_requested', key: HR },
      { type: 'unsubscribe_failed', key: HR, error },
    );
    expect(subscriptionOf(state, HR)).toMatchObject({
      phase: 'on',
      notificationCount: 3,
      lastError: error,
    });
    expect(describeSubscription(subscriptionOf(state, HR))).toEqual({
      value: 'On',
      detail: '3 notifications received. status 133 (subscription_failed)',
    });
  });

  it('accumulates batched counts per characteristic and keeps the newest time', () => {
    let state = reduce(
      initialSubscriptionsState,
      { type: 'subscribe_requested', key: HR },
      { type: 'subscribe_succeeded', key: HR },
    );
    expect(reduce(state, { type: 'values_received', counts: [] })).toBe(state);
    state = reduce(state, {
      type: 'values_received',
      counts: [
        { key: HR, count: 5, at: '2026-09-07T10:00:00.500Z' },
        { key: BATTERY, count: 1, at: '2026-09-07T10:00:00.100Z' },
      ],
    });
    state = reduce(state, {
      type: 'values_received',
      counts: [{ key: HR, count: 1, at: '2026-09-07T10:00:00.600Z' }],
    });
    expect(subscriptionOf(state, HR)).toEqual({
      phase: 'on',
      notificationCount: 6,
      lastValueAt: '2026-09-07T10:00:00.600Z',
    });
    // Values for a characteristic this app never subscribed to are still counted.
    expect(subscriptionOf(state, BATTERY)).toEqual({
      phase: 'off',
      notificationCount: 1,
      lastValueAt: '2026-09-07T10:00:00.100Z',
    });
    expect(describeSubscription(subscriptionOf(state, HR))).toEqual({
      value: 'On',
      detail: '6 notifications received.',
    });
  });

  it('drops every subscription of a device when its link ends', () => {
    const state = reduce(
      initialSubscriptionsState,
      { type: 'subscribe_requested', key: HR },
      { type: 'subscribe_succeeded', key: HR },
      { type: 'subscribe_requested', key: OTHER },
      { type: 'subscribe_succeeded', key: OTHER },
    );
    expect(reduce(state, { type: 'link_ended', deviceId: 'c' })).toBe(state);
    const ended = reduce(state, { type: 'link_ended', deviceId: 'a' });
    expect(subscriptionOf(ended, HR).phase).toBe('off');
    expect(subscriptionOf(ended, OTHER).phase).toBe('on');
    expect(Object.keys(ended)).toEqual([OTHER]);
  });

  it('describes every phase', () => {
    expect(describeSubscription({ phase: 'off', notificationCount: 0 })).toEqual({
      value: 'Off',
      detail: 'Subscribe to stream values from the device.',
    });
    expect(describeSubscription({ phase: 'subscribing', notificationCount: 0 })).toEqual({
      value: 'Subscribing…',
      detail: 'Waiting for the device to confirm.',
    });
    expect(describeSubscription({ phase: 'on', notificationCount: 1 })).toEqual({
      value: 'On',
      detail: '1 notification received.',
    });
    expect(
      describeSubscription({ phase: 'unsubscribing', notificationCount: 2 }),
    ).toEqual({
      value: 'Unsubscribing…',
      detail: '2 notifications received.',
    });
  });
});
