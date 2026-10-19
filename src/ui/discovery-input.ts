/** Validate the user-entered post count before requesting permissions or starting a task. */
export function isValidMaxPostsInput(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 1 && count <= 100;
}
