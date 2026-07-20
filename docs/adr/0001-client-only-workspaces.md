# ADR 0001: Client-only workspaces

Status: accepted

The IDE has no REST backend. OPFS is the primary workspace filesystem and the
File System Access API is an optional Chromium adapter. ZIP is the portable
fallback. Every editor, compiler and Git operation uses the same filesystem
contract so that storage modes do not leak into product features.
