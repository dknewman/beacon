import type { BleError } from '@beacon/ble-contracts';

/**
 * Subscription state per characteristic (PROJECT.md 17). Native owns the real
 * subscription; this mirrors its acknowledgements so the screen can show
 * "subscribing", "on" and the notification count, and drops everything for a
 * device when its link ends because the platform drops the subscriptions too.
 */
export type SubscriptionPhase = 'off' | 'subscribing' | 'on' | 'unsubscribing';

export interface CharacteristicSubscription {
  phase: SubscriptionPhase;
  /** Values received since the subscription was last turned on. */
  notificationCount: number;
  /** ISO timestamp of the newest value, from native. */
  lastValueAt?: string;
  /** Why the last subscribe or unsubscribe failed; cleared by the next request. */
  lastError?: BleError;
}

export type SubscriptionsState = Readonly<Record<string, CharacteristicSubscription>>;

export type SubscriptionAction =
  | { type: 'subscribe_requested'; key: string }
  | { type: 'subscribe_succeeded'; key: string }
  | { type: 'subscribe_failed'; key: string; error: BleError }
  | { type: 'unsubscribe_requested'; key: string }
  | { type: 'unsubscribe_succeeded'; key: string }
  | { type: 'unsubscribe_failed'; key: string; error: BleError }
  /** A flushed batch: how many values arrived for the key and when the newest did. */
  | {
      type: 'values_received';
      counts: ReadonlyArray<{ key: string; count: number; at: string }>;
    }
  | { type: 'link_ended'; deviceId: string };

export const initialSubscriptionsState: SubscriptionsState = {};

const OFF: CharacteristicSubscription = { phase: 'off', notificationCount: 0 };

export function subscriptionKey(
  deviceId: string,
  serviceUuid: string,
  characteristicUuid: string,
): string {
  return `${deviceId}/${serviceUuid}/${characteristicUuid}`;
}

export function subscriptionOf(
  state: SubscriptionsState,
  key: string,
): CharacteristicSubscription {
  return state[key] ?? OFF;
}

export function subscriptionsReducer(
  state: SubscriptionsState,
  action: SubscriptionAction,
): SubscriptionsState {
  switch (action.type) {
    case 'subscribe_requested': {
      const current = subscriptionOf(state, action.key);
      if (current.phase !== 'off') {
        return state;
      }
      return { ...state, [action.key]: { phase: 'subscribing', notificationCount: 0 } };
    }
    case 'subscribe_succeeded': {
      const current = subscriptionOf(state, action.key);
      if (current.phase !== 'subscribing') {
        return state;
      }
      return { ...state, [action.key]: { ...current, phase: 'on' } };
    }
    case 'subscribe_failed': {
      const current = subscriptionOf(state, action.key);
      if (current.phase !== 'subscribing') {
        return state;
      }
      return {
        ...state,
        [action.key]: { phase: 'off', notificationCount: 0, lastError: action.error },
      };
    }
    case 'unsubscribe_requested': {
      const current = subscriptionOf(state, action.key);
      if (current.phase !== 'on') {
        return state;
      }
      const { lastError: _cleared, ...rest } = current;
      return { ...state, [action.key]: { ...rest, phase: 'unsubscribing' } };
    }
    case 'unsubscribe_succeeded': {
      const current = subscriptionOf(state, action.key);
      if (current.phase !== 'unsubscribing') {
        return state;
      }
      return { ...state, [action.key]: { ...current, phase: 'off' } };
    }
    case 'unsubscribe_failed': {
      const current = subscriptionOf(state, action.key);
      if (current.phase !== 'unsubscribing') {
        return state;
      }
      // Native still delivers values, so the subscription stays on and says why.
      return {
        ...state,
        [action.key]: { ...current, phase: 'on', lastError: action.error },
      };
    }
    case 'values_received': {
      // Values for a characteristic this app never subscribed to (another client
      // on the same link, or a peripheral that notifies unasked) are counted
      // too, so the screen shows what is arriving.
      let next: Record<string, CharacteristicSubscription> | undefined;
      for (const { key, count, at } of action.counts) {
        const current = subscriptionOf(state, key);
        next ??= { ...state };
        next[key] = {
          ...current,
          notificationCount: current.notificationCount + count,
          lastValueAt: at,
        };
      }
      return next ?? state;
    }
    case 'link_ended': {
      const prefix = `${action.deviceId}/`;
      const keys = Object.keys(state).filter(key => key.startsWith(prefix));
      if (keys.length === 0) {
        return state;
      }
      const next = { ...state };
      for (const key of keys) {
        delete next[key];
      }
      return next;
    }
  }
}

/** Status row text for a subscription. */
export function describeSubscription(subscription: CharacteristicSubscription): {
  value: string;
  detail: string;
} {
  const count =
    subscription.notificationCount === 1
      ? '1 notification'
      : `${subscription.notificationCount} notifications`;
  const failure =
    subscription.lastError === undefined
      ? undefined
      : `${subscription.lastError.message} (${subscription.lastError.code})`;
  switch (subscription.phase) {
    case 'off':
      return {
        value: failure === undefined ? 'Off' : 'Failed',
        detail: failure ?? 'Subscribe to stream values from the device.',
      };
    case 'subscribing':
      return { value: 'Subscribing…', detail: 'Waiting for the device to confirm.' };
    case 'on':
      return {
        value: 'On',
        detail:
          failure === undefined ? `${count} received.` : `${count} received. ${failure}`,
      };
    case 'unsubscribing':
      return { value: 'Unsubscribing…', detail: `${count} received.` };
  }
}
