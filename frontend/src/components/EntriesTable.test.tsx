import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Entry, Payee } from "../types/api";
import { EntriesTable } from "./EntriesTable";

const ENTRIES: Entry[] = [
  {
    id: 1,
    statementId: 10,
    date: "2026-04-01",
    merchant: "One",
    amount: "1.00",
    payeeId: null,
    status: "active",
  },
  {
    id: 2,
    statementId: 10,
    date: "2026-04-02",
    merchant: "Two",
    amount: "2.00",
    payeeId: null,
    status: "active",
  },
  {
    id: 3,
    statementId: 10,
    date: "2026-04-03",
    merchant: "Three",
    amount: "3.00",
    payeeId: null,
    status: "active",
  },
  {
    id: 4,
    statementId: 10,
    date: "2026-04-04",
    merchant: "Four",
    amount: "4.00",
    payeeId: null,
    status: "active",
  },
];

const PAYEES: Payee[] = [{ id: 1, name: "Partner", shortcutSlot: null, sortOrder: 0 }];

describe("EntriesTable", () => {
  it("supports shift-selecting a range of entries", () => {
    render(
      <EntriesTable
        entries={ENTRIES}
        payees={PAYEES}
        statementFormat="amex"
        onUpdated={vi.fn()}
      />
    );

    const first = screen.getByLabelText("Select entry 1");
    const third = screen.getByLabelText("Select entry 3");

    fireEvent.click(first);
    fireEvent.click(third, { shiftKey: true });

    expect(first).toBeChecked();
    expect(screen.getByLabelText("Select entry 2")).toBeChecked();
    expect(third).toBeChecked();
    expect(screen.getByLabelText("Select entry 4")).not.toBeChecked();
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });
});
