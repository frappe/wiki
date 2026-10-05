# Agent skills

Skills for AI coding agents that work against a live Frappe Wiki site.

| Skill | What it does |
|---|---|
| [frappe-wiki-skill](frappe-wiki-skill/) | Write, sync and publish wiki pages through change requests, over `frappectl` |

A skill is one folder. `SKILL.md` is the procedure. `reference/` is the contract it works
against. `README.md` says how to point an agent at it.

The skills live in this repo, not beside the agent that reads them. A change to a
change-request API then lands in the same pull request as the skill that documents it.
