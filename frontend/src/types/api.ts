/** Mirrors backend JSON (camelCase). */

export type StatementFormat = "amex" | "yonder";

export type EntryStatus = "active" | "deferred" | "paid_archived";

export type EntryListFilter = "all" | EntryStatus;

export type Statement = {
  id: number;
  name: string;
  format: StatementFormat;
  importedAt: string;
  openEntryCount: number;
  archivedEntryCount: number;
};

export type Entry = {
  id: number;
  statementId: number;
  date: string;
  merchant: string;
  amount: string;
  payeeId: number | null;
  status: EntryStatus;
};

export type Payee = {
  id: number;
  name: string;
  shortcutSlot: number | null;
  sortOrder: number;
};

export type StatementPayeeSummary = {
  statementId: number;
  statementName: string;
  rows: Array<{
    payeeId: string;
    payeeName: string;
    entryCount: number;
    totalAmount: string;
  }>;
};

export type MerchantRule = {
  id: number;
  statementFormat: StatementFormat;
  merchantExact: string;
  payeeId: number;
  active: boolean;
};

export type PatchEntryBody = {
  payeeId?: number | null;
  status?: EntryStatus;
};

export type CreatePayeeBody = {
  name: string;
  shortcutSlot?: number | null;
  sortOrder?: number;
};

export type UpdatePayeeBody = {
  name?: string;
  shortcutSlot?: number | null;
  sortOrder?: number;
};

export type CreateRuleBody = {
  statementFormat: StatementFormat;
  merchantExact: string;
  payeeId: number;
};

export type UpdateRuleBody = {
  statementFormat?: StatementFormat;
  merchantExact?: string;
  payeeId?: number;
};

export type BatchEntriesBody = {
  updates: Array<{
    entryId: number;
    payeeId?: number | null;
    status?: EntryStatus;
  }>;
};

export type ImportStatementResult = {
  id: number;
  name: string;
  format: StatementFormat;
  importedEntries: number;
  sourceFilename?: string | null;
};
