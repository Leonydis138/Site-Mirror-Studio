---
name: Mirror archive runtime quirks
description: Non-obvious runtime and codegen constraints for the mirror archive service.
---

The archive validation path must read entries from unzipper's `Open.file()` result via its `files` array, not an `entries` property.

**Why:** The installed unzipper version returns `files`; assuming `entries` lets a crawl finish but prevents ZIP publication, which makes preview and download appear unavailable.

**How to apply:** Keep archive validation aligned with the actual unzipper runtime shape and smoke-check publication after dependency upgrades.

The generated Zod package should export only `generated/api`; exporting `generated/types` as well can collide when Orval emits a query/path parameter type with the same name as a Zod schema.

**Why:** The API contract includes combined path/query operations where current Orval output produces duplicate public names.

**How to apply:** Re-run codegen after OpenAPI changes, then run the library typecheck before changing generated files manually.