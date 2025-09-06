## Tree

```python
from frappe.utils.nestedset import get_ancestors_of, get_descendants_of, get_root_of

get_ancestors_of("Wiki Document", "rui1pbgd8q")
# ['rmjk29f25m', 'pqa0n7ji2r']
# last one is the Wiki Space
```