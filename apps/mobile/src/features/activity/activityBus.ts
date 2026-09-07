import type { SessionEventInput } from '@beacon/ble-contracts';

/**
 * Something that happened on one device's link, in the shape the session
 * recorder persists (PROJECT.md 20). The coordinators publish these as they
 * learn of them; anything interested (today the recorder) subscribes.
 */
export type DeviceActivity = { deviceId: string } & SessionEventInput;

export type ActivityListener = (activity: DeviceActivity) => void;

export interface ActivityBus {
  publish(activity: DeviceActivity): void;
  /** Returns the function that removes the listener. */
  subscribe(listener: ActivityListener): () => void;
}

/**
 * A synchronous fan-out with no history: a listener only sees what is
 * published after it subscribes. A listener that throws does not stop the
 * others; the error is reported through `onListenerError`.
 */
export function createActivityBus(
  onListenerError: (error: unknown) => void = () => undefined,
): ActivityBus {
  const listeners = new Set<ActivityListener>();
  return {
    publish(activity) {
      for (const listener of [...listeners]) {
        try {
          listener(activity);
        } catch (error) {
          onListenerError(error);
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
