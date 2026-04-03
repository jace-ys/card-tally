import type {
  BatchEntriesBody,
  CreatePayeeBody,
  CreateRuleBody,
  Entry,
  EntryListFilter,
  EntryStatus,
  ImportStatementResult,
  MerchantRule,
  PatchEntryBody,
  Payee,
  Statement,
  StatementFormat,
  StatementPayeeSummary,
  UpdatePayeeBody,
  UpdateRuleBody,
} from "../types/api";

function baseUrl(): string {
  const env = import.meta.env.VITE_API_BASE;
  if (env && env.length > 0) return env.replace(/\/$/, "");
  return "/api";
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function apiBodyMessage(body: unknown): string | null {
  if (typeof body === "string" && body.trim().length > 0) return body.trim();
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (typeof obj.error === "string" && obj.error.trim().length > 0) {
      return obj.error.trim();
    }
    if (typeof obj.message === "string" && obj.message.trim().length > 0) {
      return obj.message.trim();
    }
  }
  return null;
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError("Invalid JSON from API", res.status, text);
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { parse?: "json" | "void" }
): Promise<T> {
  const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown = body;
    try {
      parsed = body ? JSON.parse(body) : body;
    } catch {
      /* keep text */
    }
    const detail = apiBodyMessage(parsed);
    const fallback = res.statusText || `HTTP ${res.status}`;
    throw new ApiError(detail ?? fallback, res.status, parsed);
  }
  if (init?.parse === "void") return undefined as T;
  return parseJson<T>(res);
}

function entryStatusQuery(filter: EntryListFilter): string {
  if (filter === "all") return "";
  return `?status=${encodeURIComponent(filter)}`;
}

export const api = {
  listStatements(): Promise<Statement[]> {
    return request("/statements");
  },

  deleteStatement(id: number): Promise<void> {
    return request(`/statements/${encodeURIComponent(String(id))}`, {
      method: "DELETE",
      parse: "void",
    });
  },

  importStatementCsv(params: {
    file: File;
    format: StatementFormat;
    name?: string;
  }): Promise<ImportStatementResult> {
    const fd = new FormData();
    fd.append("file", params.file);
    fd.append("format", params.format);
    if (params.name) fd.append("name", params.name);
    return request("/statements/import", { method: "POST", body: fd });
  },

  listEntries(statementId: number, filter: EntryListFilter): Promise<Entry[]> {
    const q = entryStatusQuery(filter);
    return request(`/statements/${encodeURIComponent(String(statementId))}/entries${q}`);
  },

  listArchivedEntries(statementId?: number): Promise<Entry[]> {
    const q =
      statementId !== undefined
        ? `?statementId=${encodeURIComponent(String(statementId))}`
        : "";
    return request(`/archive/entries${q}`);
  },

  patchEntry(entryId: number, body: PatchEntryBody): Promise<Entry> {
    return request(`/entries/${encodeURIComponent(String(entryId))}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  batchUpdateEntries(body: BatchEntriesBody): Promise<{ updated: number }> {
    return request("/entries/batch", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  statementPayeeSummary(
    statementId: number,
    opts?: { status?: EntryStatus }
  ): Promise<StatementPayeeSummary> {
    const q =
      opts?.status !== undefined
        ? `?status=${encodeURIComponent(opts.status)}`
        : "";
    return request(
      `/statements/${encodeURIComponent(String(statementId))}/summary-by-payee${q}`
    );
  },

  listPayees(): Promise<Payee[]> {
    return request("/payees");
  },

  createPayee(body: CreatePayeeBody): Promise<Payee> {
    return request("/payees", { method: "POST", body: JSON.stringify(body) });
  },

  updatePayee(id: number, body: UpdatePayeeBody): Promise<Payee> {
    return request(`/payees/${encodeURIComponent(String(id))}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deletePayee(id: number): Promise<void> {
    return request(`/payees/${encodeURIComponent(String(id))}`, {
      method: "DELETE",
      parse: "void",
    });
  },

  listRules(): Promise<MerchantRule[]> {
    return request("/rules");
  },

  createRule(body: CreateRuleBody): Promise<MerchantRule> {
    return request("/rules", { method: "POST", body: JSON.stringify(body) });
  },

  updateRule(id: number, body: UpdateRuleBody): Promise<MerchantRule> {
    return request(`/rules/${encodeURIComponent(String(id))}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteRule(id: number): Promise<void> {
    return request(`/rules/${encodeURIComponent(String(id))}`, {
      method: "DELETE",
      parse: "void",
    });
  },
};
