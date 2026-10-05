"""Build one `apply_cr_operations` batch.

Temp keys are only valid inside the batch that creates them, so a batch is
built whole and sent once.
"""

from __future__ import annotations


class Batch:
	def __init__(self):
		self.ops: list[dict] = []
		self.log: list[str] = []  # one human line per op, printed after apply
		self._n = 0

	def create(
		self,
		parent_key: str,
		title: str,
		slug: str,
		*,
		group: bool = False,
		content: str = "",
		published: bool = True,
		index: int | None = None,
		label: str = "",
	) -> str:
		tmp = f"tmp-{self._next()}"
		op = {
			"type": "create_node",
			"temp_key": tmp,
			"parent_key": parent_key,
			"title": title,
			"slug": slug,
			"is_group": group,
			"is_published": published,
		}
		if not group:
			op["content"] = content
		if index is not None:
			op["order_index"] = index
		self._add(op, f"create  {label or slug}")
		return tmp

	def update_content(self, key: str, content: str, title: str | None = None, label: str = ""):
		op = {"type": "update_content", "doc_key": key, "content": content}
		if title is not None:
			op["title"] = title
		self._add(op, f"update  {label or key}")

	def update_fields(self, key: str, fields: dict, label: str = ""):
		shown = ", ".join(f"{k}={v}" for k, v in fields.items())
		self._add(
			{"type": "update_node", "doc_key": key, "fields": fields}, f"set     {label or key}: {shown}"
		)

	def move(self, key: str, parent_key: str, index: int | None = None, label: str = ""):
		op = {"type": "move_node", "doc_key": key, "target_parent_key": parent_key}
		if index is not None:
			op["order_index"] = index
		self._add(op, f"move    {label or key}")

	def reorder(self, parent_key: str, keys: list[str], label: str = ""):
		self._add(
			{"type": "reorder_children", "parent_key": parent_key, "ordered_doc_keys": keys},
			f"reorder {label or parent_key}",
		)

	def delete(self, key: str, label: str = ""):
		self._add({"type": "delete_node", "doc_key": key}, f"delete  {label or key}")

	def _add(self, op: dict, line: str):
		op["id"] = f"op-{self._next()}"
		self.ops.append(op)
		self.log.append(line)

	def _next(self) -> int:
		self._n += 1
		return self._n
