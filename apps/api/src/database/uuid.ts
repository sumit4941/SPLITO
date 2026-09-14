export function compareUuid(left: string, right: string): number {
  return left.replaceAll('-', '').localeCompare(right.replaceAll('-', ''));
}
