import { BleError, type GattService } from '@beacon/ble-contracts';
import { gattReducer, gattStatusOf, initialGattState } from '../gattReducer';

const id = 'dev-1';
const services: GattService[] = [
  { uuid: '0000180D-0000-1000-8000-00805F9B34FB', primary: true, characteristics: [] },
];
const error = new BleError({ code: 'service_not_found', message: 'nope' });

describe('gattReducer', () => {
  it('walks idle → discovering → ready and clears with the link', () => {
    let state = gattReducer(initialGattState, {
      type: 'discovery_requested',
      deviceId: id,
    });
    expect(gattStatusOf(state, id)).toEqual({ phase: 'discovering' });
    state = gattReducer(state, { type: 'discovery_succeeded', deviceId: id, services });
    expect(gattStatusOf(state, id)).toEqual({ phase: 'ready', services });
    state = gattReducer(state, { type: 'link_ended', deviceId: id });
    expect(gattStatusOf(state, id)).toEqual({ phase: 'idle' });
    expect(Object.keys(state)).toEqual([]);
  });

  it('records failures only for a discovery in flight', () => {
    const discovering = gattReducer(initialGattState, {
      type: 'discovery_requested',
      deviceId: id,
    });
    expect(
      gattStatusOf(
        gattReducer(discovering, { type: 'discovery_failed', deviceId: id, error }),
        id,
      ),
    ).toEqual({ phase: 'failed', error });
    expect(
      gattReducer(initialGattState, { type: 'discovery_failed', deviceId: id, error }),
    ).toBe(initialGattState);
    expect(
      gattReducer(initialGattState, {
        type: 'discovery_succeeded',
        deviceId: id,
        services,
      }),
    ).toBe(initialGattState);
  });

  it('ignores redundant requests and unknown link ends', () => {
    const discovering = gattReducer(initialGattState, {
      type: 'discovery_requested',
      deviceId: id,
    });
    expect(gattReducer(discovering, { type: 'discovery_requested', deviceId: id })).toBe(
      discovering,
    );
    expect(gattReducer(initialGattState, { type: 'link_ended', deviceId: id })).toBe(
      initialGattState,
    );
  });

  it('keeps devices independent', () => {
    let state = gattReducer(initialGattState, {
      type: 'discovery_requested',
      deviceId: 'a',
    });
    state = gattReducer(state, { type: 'discovery_requested', deviceId: 'b' });
    state = gattReducer(state, { type: 'discovery_succeeded', deviceId: 'a', services });
    state = gattReducer(state, { type: 'link_ended', deviceId: 'b' });
    expect(gattStatusOf(state, 'a').phase).toBe('ready');
    expect(gattStatusOf(state, 'b').phase).toBe('idle');
  });
});
