export async function readTextLob(value: unknown): Promise<string | undefined> {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'getData' in value) {
    const result = await (value as { getData(): Promise<unknown> }).getData();
    if (typeof result === 'string') return result;
  }
  throw new Error('Expected an Oracle text LOB');
}
