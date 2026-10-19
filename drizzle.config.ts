import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/infrastructure/db/schema/index.ts",
  out: "./src/infrastructure/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_ADMIN_URL"] || process.env["DATABASE_URL"] || "",
  },
  strict: true,
  verbose: true,
});
