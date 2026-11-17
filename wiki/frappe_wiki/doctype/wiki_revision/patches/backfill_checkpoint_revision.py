import frappe


def execute():
	# Overlays written before checkpoints all sit directly on a full revision.
	Revision = frappe.qb.DocType("Wiki Revision")
	(
		frappe.qb.update(Revision)
		.set(Revision.checkpoint_revision, Revision.parent_revision)
		.where((Revision.is_overlay == 1) & Revision.checkpoint_revision.isnull())
	).run()
