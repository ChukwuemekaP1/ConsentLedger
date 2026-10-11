# infrastructure/config

The ONLY place that reads process.env.
Validates all environment variables at boot with Zod.
Exports a typed, frozen config object.
