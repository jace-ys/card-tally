import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusSelect } from "./StatusSelect";

describe("StatusSelect", () => {
  it("calls onChange when status changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StatusSelect value="active" onChange={onChange} />
    );
    await user.selectOptions(screen.getByRole("combobox"), "deferred");
    expect(onChange).toHaveBeenCalledWith("deferred");
  });

  it("disables paid option when requested", () => {
    render(
      <StatusSelect
        value="active"
        onChange={() => {}}
        disablePaidArchived
      />
    );
    expect(
      screen.getByRole("option", { name: "Paid (archived)" })
    ).toBeDisabled();
  });
});
