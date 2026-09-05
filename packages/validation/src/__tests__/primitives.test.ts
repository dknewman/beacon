import {
  hexStringSchema,
  isoTimestampSchema,
  rssiSchema,
  uuidSchema,
} from '../schemas/primitives';

describe('uuidSchema', () => {
  it('transforms to canonical form', () => {
    expect(uuidSchema.parse('2a37')).toBe('00002A37-0000-1000-8000-00805F9B34FB');
  });
  it('reports invalid UUIDs as issues instead of throwing InvalidUuidError', () => {
    const result = uuidSchema.safeParse('nope');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('Invalid Bluetooth UUID');
    }
  });
});

describe('isoTimestampSchema', () => {
  it('accepts millisecond precision UTC and offset timestamps', () => {
    expect(isoTimestampSchema.safeParse('2026-09-05T10:31:02.102Z').success).toBe(true);
    expect(isoTimestampSchema.safeParse('2026-09-05T10:31:02.102+02:00').success).toBe(
      true,
    );
  });
  it('rejects epoch numbers and bare dates', () => {
    expect(isoTimestampSchema.safeParse(1757068262102).success).toBe(false);
    expect(isoTimestampSchema.safeParse('2026-09-05').success).toBe(false);
  });
});

describe('rssiSchema', () => {
  it('accepts realistic values and rejects positive-sign bugs', () => {
    expect(rssiSchema.safeParse(-48).success).toBe(true);
    expect(rssiSchema.safeParse(48).success).toBe(false);
    expect(rssiSchema.safeParse(-48.5).success).toBe(false);
  });
});

describe('hexStringSchema', () => {
  it('requires uppercase even-length hex', () => {
    expect(hexStringSchema.safeParse('029A1C0000').success).toBe(true);
    expect(hexStringSchema.safeParse('').success).toBe(true);
    expect(hexStringSchema.safeParse('029a1c').success).toBe(false);
    expect(hexStringSchema.safeParse('029').success).toBe(false);
  });
});
