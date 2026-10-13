// Keep historical rows; withdrawn features cannot be offered or granted again.
export const isRetiredResource = (resource: string) => resource === 'communication_templates';
export function activePermissionRules<T extends {resource: string}>(rules: T[]): T[] {
  return rules.filter(rule => !isRetiredResource(rule.resource));
}
export const isRetiredMailField = (key: string) => ['mail_header', 'mail_footer'].includes(key);
export function withoutMailLayout<T extends Record<string, unknown>>(row: T) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !isRetiredMailField(key))) as Omit<T, 'mail_header' | 'mail_footer'>;
}
