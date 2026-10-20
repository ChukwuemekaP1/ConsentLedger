// Component test setup: jsdom must never reach the network or the database.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

delete process.env["DATABASE_URL"];
delete process.env["DATABASE_ADMIN_URL"];

afterEach(() => {
  cleanup();
});
