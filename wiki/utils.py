import difflib

import frappe


def check_app_permission():
	"""Check if user has permission to access the app (for showing the app on app screen)"""

	if frappe.session.user == "Administrator":
		return True

	roles = frappe.get_roles()
	if "Wiki Approver" in roles:
		return True

	return False


def apply_markdown_diff(original_md, modified_md):
	"""
	Compares two markdown texts, finds the differences, and applies them to the original text.

	Args:
				original_md (str): The original markdown text.
				modified_md (str): The modified markdown text.

	Returns:
				tuple: A tuple containing the updated markdown text and a list of changes with their positions.
	"""
	original_lines = original_md.split("\n")
	modified_lines = modified_md.split("\n")

	# Initialize the SequenceMatcher to compare the two lists of lines
	matcher = difflib.SequenceMatcher(None, original_lines, modified_lines)
	opcodes = matcher.get_opcodes()

	# Sort opcodes by the reverse order of the original start index to handle index shifting
	sorted_opcodes = sorted(opcodes, key=lambda x: (-x[1], x[0]))

	# Create a copy of the original lines to apply changes
	result = list(original_lines)
	changes = []

	for tag, i1, i2, j1, j2 in sorted_opcodes:
		# Convert original line indices to 1-based for reporting
		original_range = None
		if i1 < i2:
			original_start = i1 + 1
			original_end = i2
			original_range = (original_start, original_end)

		if tag == "delete":
			# Record the deletion change
			changes.append({"type": "delete", "original_lines": original_range, "content": None})
			# Apply deletion to the result
			del result[i1:i2]
		elif tag == "insert":
			# Record the insertion change with position (1-based)
			content = modified_lines[j1:j2]
			position = i1 + 1  # Convert to 1-based position
			changes.append(
				{"type": "insert", "original_lines": None, "content": content, "position": position}
			)
			# Apply insertion to the result
			result[i1:i1] = content
		elif tag == "replace":
			# Record the replacement change
			content = modified_lines[j1:j2]
			changes.append({"type": "replace", "original_lines": original_range, "content": content})
			# Apply replacement: delete original lines and insert new content
			del result[i1:i2]
			result[i1:i1] = content
		# 'equal' changes are ignored

	# Join the modified lines back into a single string
	updated_md = "\n".join(result)
	return updated_md, changes


def apply_changes(original_md, changes):
	"""
	Applies a list of changes to the original markdown text.

	Args:
				original_md (str): The original markdown text.
				changes (list): A list of changes as returned by apply_markdown_diff.

	Returns:
				str: The modified markdown text after applying all changes.
	"""
	lines = original_md.split("\n")

	# Sort changes in reverse order of their original line numbers to handle index shifting
	sorted_changes = sorted(
		changes, key=lambda x: (-x["original_lines"][0] if x["original_lines"] else -x["position"])
	)

	for change in sorted_changes:
		if change["type"] == "delete":
			start = change["original_lines"][0] - 1  # Convert to 0-based index
			end = change["original_lines"][1]
			del lines[start:end]
		elif change["type"] == "insert":
			position = change["position"] - 1  # Convert to 0-based index
			lines[position:position] = change["content"]
		elif change["type"] == "replace":
			start = change["original_lines"][0] - 1
			end = change["original_lines"][1]
			del lines[start:end]
			lines[start:start] = change["content"]

	return "\n".join(lines)


def highlight_changes(original_md, changes):
	"""
	Highlights changes in the original markdown text using <ins> and <del> tags.

	Args:
				original_md (str): The original markdown text.
				changes (list): A list of changes as returned by apply_markdown_diff.

	Returns:
				str: The modified markdown text with changes highlighted.
	"""
	lines = original_md.split("\n")

	# Sort changes in reverse order of their original line numbers to handle index shifting
	sorted_changes = sorted(
		changes, key=lambda x: (-x["original_lines"][0] if x["original_lines"] else -x["position"])
	)

	for change in sorted_changes:
		if change["type"] == "delete":
			start = change["original_lines"][0] - 1  # Convert to 0-based index
			end = change["original_lines"][1]
			# Wrap deleted lines with <del> tags
			for i in range(start, end):
				lines[i] = f"<del>{lines[i]}</del>"
		elif change["type"] == "insert":
			position = change["position"] - 1  # Convert to 0-based index
			# Insert new lines with <ins> tags
			for line in change["content"]:
				lines.insert(position, f"<ins>{line}</ins>")
				position += 1
		elif change["type"] == "replace":
			start = change["original_lines"][0] - 1
			end = change["original_lines"][1]
			# Wrap deleted lines with <del> tags
			for i in range(start, end):
				lines[i] = f"<del>{lines[i]}</del>"
			# Insert new lines with <ins> tags after the deleted lines
			insert_pos = end
			for line in change["content"]:
				lines.insert(insert_pos, f"<ins>{line}</ins>")
				insert_pos += 1

	return "\n".join(lines)
