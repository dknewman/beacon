import { createActivityBus, type DeviceActivity } from '../activityBus';

const rssi = (deviceId: string, value: number): DeviceActivity => ({
  deviceId,
  kind: 'rssi',
  rssi: value,
  timestamp: '2026-01-01T00:00:00.000Z',
});

describe('createActivityBus', () => {
  it('delivers each publication to every current listener', () => {
    const bus = createActivityBus();
    const seenA: DeviceActivity[] = [];
    const seenB: DeviceActivity[] = [];
    bus.subscribe(activity => seenA.push(activity));
    const unsubscribeB = bus.subscribe(activity => seenB.push(activity));

    bus.publish(rssi('dev', -50));
    unsubscribeB();
    bus.publish(rssi('dev', -60));

    expect(seenA.map(activity => (activity.kind === 'rssi' ? activity.rssi : 0))).toEqual(
      [-50, -60],
    );
    expect(seenB).toHaveLength(1);
  });

  it('does not replay history to a late subscriber', () => {
    const bus = createActivityBus();
    bus.publish(rssi('dev', -50));
    const seen: DeviceActivity[] = [];
    bus.subscribe(activity => seen.push(activity));
    expect(seen).toEqual([]);
  });

  it('keeps delivering when a listener throws and reports the error', () => {
    const errors: unknown[] = [];
    const bus = createActivityBus(error => errors.push(error));
    const seen: DeviceActivity[] = [];
    bus.subscribe(() => {
      throw new Error('listener broke');
    });
    bus.subscribe(activity => seen.push(activity));

    bus.publish(rssi('dev', -40));

    expect(seen).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('listener broke');
  });

  it('tolerates a listener unsubscribing itself during delivery', () => {
    const bus = createActivityBus();
    const seen: string[] = [];
    const unsubscribe = bus.subscribe(() => {
      seen.push('first');
      unsubscribe();
    });
    bus.subscribe(() => seen.push('second'));

    bus.publish(rssi('dev', -40));
    bus.publish(rssi('dev', -41));

    expect(seen).toEqual(['first', 'second', 'second']);
  });
});
