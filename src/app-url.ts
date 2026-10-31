export function miniAppUrl(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/app`;
}
