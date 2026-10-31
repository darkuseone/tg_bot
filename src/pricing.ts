export const TEST_STAR_PRICE = 1;

export function isTestMode(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function priceForUser(input: {
  publicPrice: number;
  userId: number;
  adminId: string;
  testMode: string | undefined;
}): number {
  if (isTestMode(input.testMode) && String(input.userId) === input.adminId.trim()) {
    return TEST_STAR_PRICE;
  }
  return input.publicPrice;
}
