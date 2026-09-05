import { BleError, isBleError, isBleErrorCode, toBleError } from '../errors';

describe('BleError', () => {
  it('carries the shared error code and native diagnostics', () => {
    const error = new BleError({
      code: 'connection_timeout',
      message: 'Timed out after 10s',
      nativeCode: '6',
      nativeDomain: 'CBErrorDomain',
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('BleError');
    expect(error.code).toBe('connection_timeout');
    expect(error.toInfo()).toEqual({
      code: 'connection_timeout',
      message: 'Timed out after 10s',
      nativeCode: '6',
      nativeDomain: 'CBErrorDomain',
    });
  });

  it('omits undefined native fields from toInfo', () => {
    expect(new BleError({ code: 'unknown', message: 'x' }).toInfo()).toEqual({
      code: 'unknown',
      message: 'x',
    });
  });
});

describe('toBleError', () => {
  it('returns BleError instances unchanged', () => {
    const error = new BleError({ code: 'read_failed', message: 'nope' });
    expect(toBleError(error)).toBe(error);
  });

  it('maps native promise rejections that carry a known code', () => {
    const rejection = Object.assign(new Error('Adapter is off'), {
      code: 'bluetooth_powered_off',
    });
    const error = toBleError(rejection);
    expect(error.code).toBe('bluetooth_powered_off');
    expect(error.message).toBe('Adapter is off');
    expect(error.cause).toBe(rejection);
  });

  it('falls back when the rejection code is not part of the contract', () => {
    const rejection = Object.assign(new Error('boom'), { code: 'E_SOMETHING' });
    expect(toBleError(rejection).code).toBe('unknown');
    expect(toBleError(rejection, 'native_failure').code).toBe('native_failure');
  });

  it('wraps non-Error values', () => {
    const error = toBleError('string failure');
    expect(error.code).toBe('unknown');
    expect(error.message).toBe('string failure');
    expect(isBleError(error)).toBe(true);
  });
});

describe('isBleErrorCode', () => {
  it('accepts contract codes only', () => {
    expect(isBleErrorCode('scan_failed')).toBe(true);
    expect(isBleErrorCode('SCAN_FAILED')).toBe(false);
    expect(isBleErrorCode(42)).toBe(false);
  });
});
