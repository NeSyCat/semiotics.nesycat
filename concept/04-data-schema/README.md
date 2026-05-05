# 04-data-schema

Supabase project configuration. `config.toml` defines the local-dev project (ports, names) used by the `supabase` CLI.

The **runtime** Supabase clients (browser + server SSR + middleware) live in `/lib/supabase/` — they consume the project URL + keys from environment variables, not from this config.

### Note on the Supabase CLI

The `supabase` CLI looks for `supabase/config.toml` relative to its working directory. Since the file now lives at `concept/04-data-schema/config.toml`, run CLI commands from this folder:

```bash
cd concept/04-data-schema
supabase start
supabase db push
```

There are no `package.json` scripts that invoke the CLI directly today.
