// Unit test setup — unit tests must never touch the database or network.
delete process.env["DATABASE_URL"];
delete process.env["DATABASE_ADMIN_URL"];
