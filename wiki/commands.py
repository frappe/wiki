import os
import time
from pathlib import Path

import click
from frappe.commands import get_site, pass_context


@click.group("wiki")
def wiki_commands():
	"""Frappe Wiki tools."""


@wiki_commands.command("preview-docs")
@click.argument("path", type=click.Path(file_okay=False))
@click.option("--route", required=True, help="Route of the preview space, for example docs")
@click.option("--name", "space_name", help="Space name when the space is created. Defaults to the route.")
@click.option("--watch", is_flag=True, default=False, help="Sync again whenever a file in the folder changes")
@pass_context
def preview_docs(context, path: str, route: str, space_name: str | None, watch: bool):
	"""Sync a docs folder on disk into a git-synced space, the way GitHub Sync will after a push.

	Needs developer mode. Reuses the git-synced space at the route, or creates one.
	"""
	import frappe

	from wiki.wiki.git_sync import LocalFolder, preview_local_docs

	# bench runs every command from sites/, so a relative path is relative to the folder the user is in.
	folder = Path(os.environ.get("PWD") or os.getcwd(), path).resolve()
	frappe.init(get_site(context))
	frappe.connect()
	frappe.set_user("Administrator")  # nosemgrep
	try:
		stamp = None
		while True:
			current = LocalFolder(folder).get_stamp()
			if current != stamp:
				stamp = current
				report(preview_local_docs(folder, route, space_name))
			if not watch:
				break
			time.sleep(1)
	except KeyboardInterrupt:
		pass
	finally:
		frappe.destroy()


def report(space) -> None:
	import frappe

	frappe.db.commit()  # nosemgrep
	if space.last_sync_status == "Error":
		click.secho(f"Sync failed:\n{space.last_sync_error}", fg="red")
		return
	click.secho(f"{time.strftime('%H:%M:%S')} Synced {space.space_name}: /{space.route}", fg="green")


commands = [wiki_commands]
