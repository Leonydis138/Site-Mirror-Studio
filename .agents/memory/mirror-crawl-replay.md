---
name: Mirror crawl and replay behavior
description: Durable constraints for capturing and replaying client-rendered sites and browser games.
---

Dynamic site completeness depends on allowing safe same-origin browser resources, waiting briefly for client-rendered work, and recording runtime-loaded same-origin URLs in addition to static DOM references. Resolve discovered markup against the final redirected URL.

**Why:** Blocking stylesheets, images, fonts, or media during navigation and resolving links against the pre-redirect URL causes missing assets and broken relative links in the sealed archive.

**How to apply:** Keep the browser interception SSRF checks active, but do not block safe same-origin resource types; use the final page URL for relative references and keep a bounded network-idle wait.

Previewed game pages need same-origin sandbox access for relative API calls, storage, and local replay behavior. The preview runtime should intercept recognized game service paths and provide deterministic local responses.

**Why:** A sandbox without `allow-same-origin` makes the archived page opaque-origin, so same-origin game requests and storage-backed game code fail even when the HTML and scripts were saved.

**How to apply:** Preserve the preview iframe's same-origin sandbox permission together with the runtime's request interception and the preview CSP.