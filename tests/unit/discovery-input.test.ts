import { describe, expect, it } from 'vitest';
import { isValidMaxPostsInput } from '../../src/ui/discovery-input';

describe('isValidMaxPostsInput', () => {
  it.each(['1', '2', '20', '99', '100', '01'])('accepts valid integer input %s', value => {
    expect(isValidMaxPostsInput(value)).toBe(true);
  });

  it.each(['', ' ', '0', '-1', '101', '1.5', '1e2', 'abc', 'Infinity'])(
    'rejects invalid post count input %s',
    value => {
      expect(isValidMaxPostsInput(value)).toBe(false);
    },
  );
});
