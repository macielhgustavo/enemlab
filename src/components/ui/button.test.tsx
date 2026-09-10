import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";

describe("Button como link", () => {
  it.each(["disabled", "loading"] as const)("%s impede ativação pelo teclado", async (state) => {
    const navigate = vi.fn();
    render(<Button asChild {...{ [state]: true }}><a href="#destination" onClick={navigate}>Continuar</a></Button>);
    const link = screen.getByRole("link", { name: "Continuar" });
    link.focus();
    await userEvent.keyboard("{Enter}");
    expect(navigate).not.toHaveBeenCalled();
    expect(link).toHaveAttribute("aria-disabled", "true");
  });
  it("preserva a ação quando habilitado", async () => {
    const navigate = vi.fn((event) => event.preventDefault());
    render(<Button asChild><a href="#destination" onClick={navigate}>Continuar</a></Button>);
    screen.getByRole("link", { name: "Continuar" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(navigate).toHaveBeenCalledOnce();
  });
});
