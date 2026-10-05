# frappe-wiki-authoring

A skill that lets a coding agent write and publish Frappe Wiki pages on a live site
through change requests. It works over `frappectl`, needs no wiki source, and installs
nothing on the site. It supports Wiki v3 sites only.

`SKILL.md` is the procedure. `scripts/wikictl.py` is the tool the agent runs. `reference/`
holds the command reference and the raw API.

## Install

**Give this page to your agent and ask it to set the skill up.** The steps are written for
the agent. You can also do them by hand.

### 1. Get the skill

Each agent gets a link to one copy, so `git pull` updates the skill. The skill then cannot
drift from the API it documents.

```sh
git clone https://github.com/frappe/wiki
SKILL=$PWD/wiki/skills/frappe-wiki-authoring
```

### 2. Point the agent at it

Link the skill into the agent's skills folder:

| Agent | Folder |
|---|---|
| Claude Code | `~/.claude/skills` |
| Codex | `~/.codex/skills` |

```sh
mkdir -p ~/.claude/skills
ln -s "$SKILL" ~/.claude/skills/frappe-wiki-authoring
```

The agent reads the `description` in `SKILL.md` and uses the skill when a task fits.

An agent with no skill loader takes a prompt instead. Put the real path in place of
`$SKILL`:

> Read `$SKILL/SKILL.md` and follow it. Read the files under `$SKILL/reference/` when it
> tells you to.

### 3. Give it a site

The skill needs a `frappectl` profile. **Make it yourself.** The skill tells the agent not
to run `auth` commands, so it does not do this step.

```sh
uv tool install frappectl
frappectl auth login https://your-wiki-site --name your-site
```

The agent acts as the profile's user. It can read and change only what that user can. To
limit the agent, give it a profile for a user with less access.

## Check it worked

Ask the agent to list the wiki spaces on the site. It should use the skill. Its first call
should be `frappectl -s <your-site> auth whoami`, then `wikictl spaces`.

## Develop

```sh
python3 -m unittest discover -s skills/frappe-wiki-authoring/scripts/tests
```

The tool uses the standard library only, and Python 3.10 or later.
