# Factory Techniques Reference

## Pyramid Summaries

Reversible summarization: compress context at multiple zoom levels (2 words → 4 → 8 → 16) while maintaining ability to expand back. Enables rapid enumeration with minimal context displacement — scan many items at compressed level, expand only relevant ones.

Pattern: generate summaries in parallel, group by compressed representations, synthesize while expanding selectively.

## Filesystem as Semantic Index

The filesystem is a mutable, inspectable world-state for agent context and memory:
- Directories: meaningful hierarchies
- Indexes: markdown-based catalogs
- State: persisted in markdown/JSON/YAML

"Genrefying" = restructuring information to optimize future retrieval (library science term). Rebalancing operations executed by LLMs directly on the filesystem.

Key advantages: self-organizing context, persistent memory across sessions, inspectable/auditable state, composable knowledge between agents.
