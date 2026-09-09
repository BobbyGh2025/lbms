// ============================================================================
// LBMS Finance — Constants & Types
// ----------------------------------------------------------------------------
// Canonical finance domain types. Used by the posting engine, API routes,
// and UI. Keeping them in one place prevents string-literal drift.
// ============================================================================

export const TRANSACTION_TYPES = [
  "income",
  "expense",
  "transfer",
  "opening_balance",
  "adjustment",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const JOURNAL_STATUSES = ["draft", "posted", "voided", "reversed"] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export const ACCOUNT_CLASSES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountClass = (typeof ACCOUNT_CLASSES)[number];

export const PAYMENT_METHODS = [
  "cash",
  "bank_transfer",
  "mobile_money",
  "card",
  "cheque",
  "other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PARTY_TYPES = ["customer", "supplier"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

// Reference prefixes — one per transaction type (plus opening/adjustment).
export const REF_PREFIXES = {
  income: "INC",
  expense: "EXP",
  transfer: "TRF",
  opening_balance: "OPB",
  adjustment: "ADJ",
} as const;

/** Validate that a string is a known transaction type. */
export function isTransactionType(v: string): v is TransactionType {
  return (TRANSACTION_TYPES as readonly string[]).includes(v);
}

/** Validate that a string is a known payment method. */
export function isPaymentMethod(v: string): v is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(v);
}

/** Validate that a string is a known account class. */
export function isAccountClass(v: string): v is AccountClass {
  return (ACCOUNT_CLASSES as readonly string[]).includes(v);
}
