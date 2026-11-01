import { formatNpr } from './domain.ts';

/** Plain decimal rupees for an editable field, preserving every integer paisa. */
export function amountInput(cents: number): string {
  return formatNpr(cents).slice(4).replaceAll(',', '');
}
